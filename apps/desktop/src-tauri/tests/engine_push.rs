//! El cliente del motor contra un motor RPC1 de laboratorio: una conexión por
//! petición con un motor viejo, conexión persistente y suscripción con uno que
//! anuncia `push_stream_v1`.
#![cfg(unix)]
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use terminus_engine_client::{
    push::{Feed, Start},
    Client,
};
use terminus_engine_protocol::{PRODUCT, VERSION};

#[derive(Default)]
struct Seen {
    connections: AtomicUsize,
    commands: Mutex<Vec<(String, Value)>>,
    open: Mutex<Vec<TcpStream>>,
    refuse: AtomicBool,
    // El primer `service subscribe` con cursor contesta `resync_required` con este `latest`.
    resync_latest: Mutex<Option<u64>>,
}

struct Engine {
    seen: Arc<Seen>,
    _root: tempfile::TempDir,
    selection: PathBuf,
    credential: PathBuf,
}

fn private(path: &Path, bytes: &[u8]) {
    std::fs::write(path, bytes).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
}

fn status(data: &Path, push: bool) -> Value {
    let mut status = json!({
        "runtime": "r1", "product": PRODUCT, "contract": terminus_engine_client::contract(),
        "service": true, "protocol_version": VERSION, "service_build": "b1",
        "data_directory": data.to_string_lossy(),
    });
    if push {
        status["service_features"] = json!(["push_stream_v1"]);
    }
    status
}

fn send(writer: &Mutex<TcpStream>, frame: &Value) {
    let mut line = serde_json::to_vec(frame).unwrap();
    line.push(b'\n');
    let _ = writer.lock().unwrap().write_all(&line);
}

fn answer(id: &str, result: Result<Value, (&str, Value)>) -> Value {
    match result {
        Ok(value) => json!({"version": VERSION, "request_id": id, "result": value, "error": null}),
        Err((code, detail)) => json!({"version": VERSION, "request_id": id, "result": null,
            "error": {"code": code, "message_key": format!("cli.error.{code}"), "detail": detail}}),
    }
}

fn respond(seen: &Seen, writer: &Mutex<TcpStream>, data: &Path, push: bool, request: Value) {
    let id = request["request_id"].as_str().unwrap().to_owned();
    let command = request["command"].as_str().unwrap().to_owned();
    let args = request["args"].clone();
    seen.commands
        .lock()
        .unwrap()
        .push((command.clone(), args.clone()));
    match command.as_str() {
        "status" => send(writer, &answer(&id, Ok(status(data, push)))),
        "service invoke" => {
            if args["command"] == "slow" {
                std::thread::sleep(Duration::from_millis(300));
            }
            send(writer, &answer(&id, Ok(json!({"value": args["command"]}))));
        }
        "service subscribe" => {
            if !args["cursor"].is_null() {
                if let Some(latest) = seen.resync_latest.lock().unwrap().take() {
                    let detail =
                        json!({"reason": "backlog_events", "latest": latest, "runtime": "r1"});
                    send(writer, &answer(&id, Err(("resync_required", detail))));
                    return;
                }
            }
            let cursor = args["cursor"].as_u64().unwrap_or(0);
            send(
                writer,
                &answer(
                    &id,
                    Ok(
                        json!({"subscription": "s1", "cursor": cursor, "latest": cursor, "runtime": "r1"}),
                    ),
                ),
            );
            send(
                writer,
                &json!({"version": VERSION, "push": "events", "subscription": "s1", "cursor": cursor + 1,
                "events": [{"seq": cursor + 1, "name": "chat", "payload": {"kind": "delta", "session": "a", "text": "hola"}}]}),
            );
        }
        "service subscription update" => {
            send(
                writer,
                &answer(
                    &id,
                    Ok(json!({"subscription": "s1", "catchup": args["sessions"]})),
                ),
            );
            for session in args["sessions"].as_array().into_iter().flatten() {
                send(
                    writer,
                    &json!({"version": VERSION, "push": "catchup", "subscription": "s1", "session": session,
                    "events": [{"seq": 2, "name": "chat", "payload": {"kind": "delta", "session": session, "text": "antes"}}]}),
                );
            }
        }
        _ => send(writer, &answer(&id, Ok(json!({})))),
    }
}

fn serve(stream: TcpStream, seen: Arc<Seen>, data: PathBuf, push: bool) {
    seen.open.lock().unwrap().push(stream.try_clone().unwrap());
    let writer = Arc::new(Mutex::new(stream.try_clone().unwrap()));
    let mut reader = BufReader::new(stream);
    loop {
        let mut line = Vec::new();
        if reader.read_until(b'\n', &mut line).unwrap_or(0) == 0 {
            return;
        }
        let request: Value = serde_json::from_slice(&line).unwrap();
        if !push {
            // Un motor viejo contesta una petición y cierra.
            respond(&seen, &writer, &data, push, request);
            return;
        }
        let (seen, writer, data) = (seen.clone(), writer.clone(), data.clone());
        std::thread::spawn(move || respond(&seen, &writer, &data, push, request));
    }
}

fn engine(push: bool) -> Engine {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    let window = root.path().join("window");
    std::fs::create_dir_all(&data).unwrap();
    std::fs::create_dir_all(&window).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let seen = Arc::new(Seen::default());
    let accepted = seen.clone();
    let served = data.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if accepted.refuse.load(Ordering::SeqCst) {
                continue;
            }
            accepted.connections.fetch_add(1, Ordering::SeqCst);
            let (seen, data) = (accepted.clone(), served.clone());
            std::thread::spawn(move || serve(stream, seen, data, push));
        }
    });
    let credential = root.path().join("token");
    private(&credential, b"secreto");
    let endpoint = root.path().join("endpoint.json");
    let contract = terminus_engine_client::contract();
    private(&endpoint, &serde_json::to_vec(&json!({
        "version": VERSION, "product": PRODUCT, "runtime": "r1", "pid": 1, "executable": "/bin/true",
        "address": address, "contract": contract, "data_directory": data, "token_file": credential,
    })).unwrap());
    let selection = root.path().join("selection.json");
    private(&selection, &serde_json::to_vec(&json!({
        "version": VERSION, "endpoint": endpoint, "credential": credential, "runtime": "r1",
        "data_directory": data, "contract": contract, "service_build": "b1", "window_data": window,
    })).unwrap());
    Engine {
        seen,
        _root: root,
        selection,
        credential,
    }
}

impl Engine {
    fn connections(&self) -> usize {
        self.seen.connections.load(Ordering::SeqCst)
    }
    fn commands(&self, name: &str) -> Vec<Value> {
        self.seen
            .commands
            .lock()
            .unwrap()
            .iter()
            .filter(|(c, _)| c == name)
            .map(|(_, a)| a.clone())
            .collect()
    }
    /// Corta todas las conexiones abiertas, como un motor que se cae.
    fn drop_connections(&self) {
        for stream in self.seen.open.lock().unwrap().drain(..) {
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
    }
    fn stop(&self) {
        self.seen.refuse.store(true, Ordering::SeqCst);
        self.drop_connections();
    }
}

fn wait_for(what: &str, mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !ready() {
        assert!(Instant::now() < deadline, "no llegó: {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn old_engine_keeps_one_connection_per_request() {
    let lab = engine(false);
    let client = Client::select(&lab.selection).unwrap();
    assert!(!client.push_stream());
    for _ in 0..3 {
        assert_eq!(
            client.invoke("ping", None, json!({})).unwrap(),
            json!({"value": "ping"})
        );
    }
    assert_eq!(lab.connections(), 4);
}

#[test]
fn persistent_link_matches_answers_that_arrive_out_of_order() {
    let lab = engine(true);
    let client = Arc::new(Client::select(&lab.selection).unwrap());
    assert!(client.push_stream());
    let slow = {
        let client = client.clone();
        std::thread::spawn(move || client.invoke("slow", None, json!({})))
    };
    std::thread::sleep(Duration::from_millis(50));
    let started = Instant::now();
    assert_eq!(
        client.invoke("fast", None, json!({})).unwrap(),
        json!({"value": "fast"})
    );
    assert!(
        started.elapsed() < Duration::from_millis(250),
        "la rápida esperó a la lenta"
    );
    assert_eq!(slow.join().unwrap().unwrap(), json!({"value": "slow"}));
    for _ in 0..20 {
        client.invoke("ping", None, json!({})).unwrap();
    }
    // `select` habla con una conexión suelta; todo lo demás va por una sola.
    assert_eq!(lab.connections(), 2);
}

#[test]
fn link_reconnects_and_validates_the_engine_again() {
    let lab = engine(true);
    let client = Client::select(&lab.selection).unwrap();
    client.invoke("ping", None, json!({})).unwrap();
    lab.drop_connections();
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(
        client.invoke("ping", None, json!({})).unwrap(),
        json!({"value": "ping"})
    );
    assert_eq!(lab.connections(), 3);
    // Cada conexión nueva pregunta `status` antes de usarse.
    assert_eq!(lab.commands("status").len(), 3);
}

#[test]
fn a_changed_selection_is_refused_before_reconnecting() {
    let lab = engine(true);
    let client = Client::select(&lab.selection).unwrap();
    client.invoke("ping", None, json!({})).unwrap();
    std::fs::remove_file(&lab.credential).unwrap();
    private(&lab.credential, b"otro");
    lab.drop_connections();
    std::thread::sleep(Duration::from_millis(50));
    let error = client.invoke("ping", None, json!({})).unwrap_err();
    assert_eq!(error.code, "invalid_token");
    assert_eq!(lab.connections(), 2);
}

#[test]
fn feed_delivers_pushed_events_and_updates_its_filter() {
    let lab = engine(true);
    let client = Arc::new(Client::select(&lab.selection).unwrap());
    let feed = Feed::start(
        client,
        Start {
            cursor: Some(5),
            replay: false,
            runtime: Some("r1".into()),
            sessions: None,
        },
    );
    let page = feed.next(Duration::from_secs(5));
    assert!(page.failure.is_none());
    assert!(!page.gap);
    assert_eq!(page.cursor, Some(6));
    assert_eq!(page.batches[0]["events"][0]["seq"], 6);
    assert_eq!(lab.commands("service subscribe")[0]["cursor"], 5);
    feed.filter(Some(vec!["b".into(), "a".into(), "a".into()]));
    let mut batches = Vec::new();
    wait_for("los dos catchup", || {
        batches.extend(feed.next(Duration::from_millis(200)).batches);
        batches.len() >= 2
    });
    assert_eq!(
        batches,
        vec![
            json!({"catchup": "a", "events": [{"seq": 2, "name": "chat", "payload": {"kind": "delta", "session": "a", "text": "antes"}}]}),
            json!({"catchup": "b", "events": [{"seq": 2, "name": "chat", "payload": {"kind": "delta", "session": "b", "text": "antes"}}]})
        ]
    );
    assert_eq!(
        lab.commands("service subscription update")[0]["sessions"],
        json!(["a", "b"])
    );
    feed.stop();
}

#[test]
fn feed_marks_a_gap_and_resumes_from_latest_on_resync_required() {
    let lab = engine(true);
    *lab.seen.resync_latest.lock().unwrap() = Some(40);
    let client = Arc::new(Client::select(&lab.selection).unwrap());
    let feed = Feed::start(
        client,
        Start {
            cursor: Some(3),
            replay: false,
            runtime: Some("r1".into()),
            sessions: None,
        },
    );
    let mut gap = false;
    let mut cursor = None;
    wait_for("los eventos después del hueco", || {
        let page = feed.next(Duration::from_millis(200));
        gap |= page.gap;
        cursor = page.cursor;
        cursor == Some(41)
    });
    assert!(gap);
    let subscribed = lab.commands("service subscribe");
    assert_eq!(
        (
            subscribed[0]["cursor"].clone(),
            subscribed[1]["cursor"].clone()
        ),
        (json!(3), json!(40))
    );
    feed.stop();
}

#[test]
fn feed_resubscribes_from_its_cursor_after_the_link_drops() {
    let lab = engine(true);
    let client = Arc::new(Client::select(&lab.selection).unwrap());
    let feed = Feed::start(
        client,
        Start {
            cursor: Some(9),
            replay: false,
            runtime: Some("r1".into()),
            sessions: None,
        },
    );
    assert_eq!(feed.next(Duration::from_secs(5)).cursor, Some(10));
    lab.drop_connections();
    wait_for("la segunda suscripción", || {
        lab.commands("service subscribe").len() == 2
    });
    assert_eq!(lab.commands("service subscribe")[1]["cursor"], 10);
    let page = feed.next(Duration::from_secs(5));
    assert!(page.failure.is_none() && !page.gap);
    assert_eq!(page.cursor, Some(11));
    feed.stop();
}

#[test]
fn feed_reports_an_engine_that_stopped_answering() {
    let lab = engine(true);
    let client = Arc::new(Client::select(&lab.selection).unwrap());
    let feed = Feed::start(
        client,
        Start {
            cursor: None,
            replay: true,
            runtime: None,
            sessions: None,
        },
    );
    feed.next(Duration::from_secs(5));
    lab.stop();
    let mut failure = None;
    wait_for("el fallo", || {
        failure = feed.next(Duration::from_millis(200)).failure;
        failure.is_some()
    });
    feed.stop();
}
