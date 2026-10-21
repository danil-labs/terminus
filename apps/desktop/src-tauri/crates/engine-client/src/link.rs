//! Una conexión RPC1 persistente: varias peticiones en vuelo, correlacionadas
//! por `request_id`, y los marcos empujados de sus suscripciones por la misma
//! línea. Solo se abre con un motor que anunció `push_stream_v1`.
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use terminus_engine_protocol::{Error, Push, Request, Response, MAX_FRAME, VERSION};

/// Por qué no volvió la respuesta. `Unsent` garantiza que el motor no recibió
/// la línea entera: reenviarla por otra conexión no la duplica.
pub(crate) enum Failure {
    Unsent(Error),
    Lost(Error),
}

/// Recibe cada marco empujado; `None` cuando la conexión se cerró.
pub(crate) type Pushes = Box<dyn Fn(Option<Push>) + Send>;

pub(crate) struct Link {
    writer: Mutex<TcpStream>,
    waiting: Mutex<HashMap<String, mpsc::SyncSender<Response>>>,
    open: AtomicBool,
    in_flight: AtomicUsize,
    heard: Mutex<Instant>,
    used: Mutex<Instant>,
}

impl Link {
    pub(crate) fn connect(
        address: &SocketAddr,
        pushes: Option<Pushes>,
    ) -> Result<Arc<Self>, Error> {
        let socket = TcpStream::connect_timeout(address, Duration::from_secs(3))
            .map_err(|_| Error::new("app_unavailable"))?;
        let _ = socket.set_nodelay(true);
        // El motor cierra a quien no lee un marco en 10 s; escribir tiene el mismo plazo.
        socket.set_write_timeout(Some(Duration::from_secs(10)))?;
        let reader = socket.try_clone()?;
        let link = Arc::new(Self {
            writer: Mutex::new(socket),
            waiting: Mutex::new(HashMap::new()),
            open: AtomicBool::new(true),
            in_flight: AtomicUsize::new(0),
            heard: Mutex::new(Instant::now()),
            used: Mutex::new(Instant::now()),
        });
        let reading = link.clone();
        std::thread::Builder::new()
            .name("engine-link".into())
            .spawn(move || reading.read(reader, pushes))
            .map_err(|_| Error::new("io"))?;
        Ok(link)
    }

    fn read(self: Arc<Self>, socket: TcpStream, pushes: Option<Pushes>) {
        let mut reader = BufReader::new(socket);
        loop {
            let mut line = Vec::new();
            match (&mut reader).take(MAX_FRAME + 1).read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            if line.len() as u64 > MAX_FRAME || line.last() != Some(&b'\n') {
                break;
            }
            *self.heard.lock().unwrap_or_else(|p| p.into_inner()) = Instant::now();
            let Ok(value) = serde_json::from_slice::<Value>(&line) else {
                break;
            };
            if value.get("push").is_some() && value.get("request_id").is_none() {
                // Un `push` que no se entiende se ignora: el contrato puede añadir marcos.
                if let (Some(pushes), Ok(push)) = (&pushes, serde_json::from_value::<Push>(value)) {
                    pushes(Some(push));
                }
                continue;
            }
            let Ok(response) = serde_json::from_value::<Response>(value) else {
                break;
            };
            if response.version != VERSION {
                break;
            }
            let waiter = self
                .waiting
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .remove(&response.request_id);
            if let Some(waiter) = waiter {
                let _ = waiter.send(response);
            }
        }
        self.close();
        if let Some(pushes) = &pushes {
            pushes(None);
        }
    }

    pub(crate) fn is_open(&self) -> bool {
        self.open.load(Ordering::SeqCst)
    }
    pub(crate) fn in_flight(&self) -> usize {
        self.in_flight.load(Ordering::SeqCst)
    }
    /// Desde cuándo no llega ninguna línea del motor.
    pub(crate) fn silent_for(&self) -> Duration {
        self.heard
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .elapsed()
    }
    pub(crate) fn idle_for(&self) -> Duration {
        self.used
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .elapsed()
    }

    pub(crate) fn close(&self) {
        if self.open.swap(false, Ordering::SeqCst) {
            let _ = self
                .writer
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .shutdown(std::net::Shutdown::Both);
        }
        // Soltar los remitentes despierta a quien espera con `Disconnected`.
        self.waiting
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
    }

    pub(crate) fn call(&self, request: &Request, timeout: Duration) -> Result<Response, Failure> {
        let mut body = serde_json::to_vec(request).map_err(|e| Failure::Unsent(e.into()))?;
        if body.len() as u64 >= MAX_FRAME {
            return Err(Failure::Unsent(Error::new("invalid_request")));
        }
        body.push(b'\n');
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut waiting = self.waiting.lock().unwrap_or_else(|p| p.into_inner());
            if !self.is_open() {
                return Err(Failure::Unsent(Error::new("app_unavailable")));
            }
            waiting.insert(request.request_id.clone(), sender);
        }
        self.in_flight.fetch_add(1, Ordering::SeqCst);
        *self.used.lock().unwrap_or_else(|p| p.into_inner()) = Instant::now();
        let written = self
            .writer
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .write_all(&body);
        let result = match written {
            // Una línea sin su `\n` no la atiende el motor: no llegó a enviarse.
            Err(_) => {
                self.close();
                Err(Failure::Unsent(Error::new("app_unavailable")))
            }
            Ok(()) => match receiver.recv_timeout(timeout) {
                Ok(response) => Ok(response),
                Err(_) => Err(Failure::Lost(Error::new("io"))),
            },
        };
        self.waiting
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&request.request_id);
        self.in_flight.fetch_sub(1, Ordering::SeqCst);
        *self.used.lock().unwrap_or_else(|p| p.into_inner()) = Instant::now();
        result
    }
}
