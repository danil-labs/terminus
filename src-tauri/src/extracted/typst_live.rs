//! La vista en vivo de un `.typ`: un `tinymist lsp` por árbol de tarea en el
//! proceso de la ventana. La carpeta, el principal y el binario los resuelve el
//! motor (`tree_typst_target`); ver docs/engine-client.md.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU16, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, LazyLock, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Url};

const PLAZO_LSP: Duration = Duration::from_secs(30);
const PLAZO_APAGADO: Duration = Duration::from_secs(2);
const TAREA_DE_LA_VISTA: &str = "terminus";

struct Proceso {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pendientes: Mutex<HashMap<u64, mpsc::Sender<Value>>>,
    siguiente: AtomicU64,
    root: PathBuf,
    main: Mutex<String>,
    puerto: AtomicU16,
    versiones: Mutex<HashMap<String, i32>>,
    /// La carpeta de trabajo del proceso: vacía y fuera del árbol, que en Windows no se podría borrar.
    _cwd: tempfile::TempDir,
}

static PROCESOS: LazyLock<Mutex<HashMap<String, Arc<Proceso>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Dos visores del mismo árbol que abren a la vez arrancarían dos Tinymist y el registro guardaría uno.
static ARRANQUE: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
pub struct VistaViva {
    /// `"sin_typst"` | `"sin_tinymist"` | `"lista"`.
    estado: &'static str,
    key: String,
    puerto: u16,
    main: String,
}

#[derive(Serialize, Clone)]
struct Aviso {
    key: String,
    /// `"diagnostics"` | `"status"` | `"jump"` (doble clic en la vista).
    kind: &'static str,
    /// Con `diagnostics` y `jump`: el archivo, relativo a la carpeta; `None` fuera de ella.
    path: Option<String>,
    /// Con `jump`: desde 1; la columna en unidades UTF-16.
    line: Option<u32>,
    column: Option<u32>,
    diagnostics: Vec<Diagnostico>,
    /// Con `status`: `"compiling"` | `"compileSuccess"` | `"compileError"`.
    status: Option<String>,
    pages: Option<u64>,
}

fn fallo(detalle: impl Into<String>) -> Value {
    json!({"what": {"clave": "code.typst.error.live"}, "detail": detalle.into()})
}

fn clave(project: &str, session: &str, tree: &str) -> String {
    format!("{project}/{session}/{tree}")
}

/// Arranca la vista del árbol, o devuelve la que ya corre con el mismo principal.
#[tauri::command(async)]
pub fn typst_live_open(
    app: AppHandle,
    project: String,
    session: String,
    tree: String,
    path: String,
    main: Option<String>,
) -> Result<VistaViva, Value> {
    // El principal se resuelve dentro del candado: dos ojos seguidos se aplican en su orden.
    let _arranque = ARRANQUE.lock().unwrap_or_else(|p| p.into_inner());
    let objetivo = super::proxy::invoke(
        &app.state::<Arc<super::proxy::State>>(),
        "tree_typst_target",
        json!({"project": project, "session": session, "tree": tree, "path": path, "main": main}),
    )?;
    let key = clave(&project, &session, &tree);
    let estado = objetivo["estado"].as_str().unwrap_or_default();
    if estado != "listo" {
        detener(&key);
        return Ok(VistaViva {
            estado: if estado == "sin_tinymist" {
                "sin_tinymist"
            } else {
                "sin_typst"
            },
            key,
            puerto: 0,
            main: String::new(),
        });
    }
    let a_ruta = |campo: &str| objetivo[campo].as_str().map(PathBuf::from);
    let (Some(root), Some(tinymist)) = (a_ruta("root"), a_ruta("tinymist")) else {
        return Err(fallo("objetivo incompleto"));
    };
    let main = objetivo["main"].as_str().unwrap_or_default().to_string();
    let vivo = PROCESOS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(&key)
        .cloned();
    if let Some(vivo) = vivo.filter(|v| v.root == root && sigue_vivo(v)) {
        let mut actual = vivo.main.lock().unwrap_or_else(|p| p.into_inner());
        // Otro principal en el mismo proceso: Tinymist cambia la entrada de su compilador y conserva lo compilado.
        let cambiado = *actual == main || cambiar_principal(&vivo, &root.join(&main)).is_ok();
        if cambiado {
            actual.clone_from(&main);
            return Ok(VistaViva {
                estado: "lista",
                key,
                puerto: vivo.puerto.load(Ordering::Relaxed),
                main,
            });
        }
    }
    detener(&key);
    let proceso =
        arrancar(&app, &key, &tinymist, a_ruta("paquetes"), &root, &main).map_err(fallo)?;
    let puerto = proceso.puerto.load(Ordering::Relaxed);
    PROCESOS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(key.clone(), proceso);
    Ok(VistaViva {
        estado: "lista",
        key,
        puerto,
        main,
    })
}

/// El texto entero de un `.typ` del árbol, tal como está en el editor.
#[tauri::command(async)]
pub fn typst_live_change(key: String, path: String, text: String) -> Result<(), Value> {
    let proceso = vivo(&key)?;
    let uri = uri_dentro(&proceso.root, &path).map_err(fallo)?;
    let mut versiones = proceso.versiones.lock().unwrap_or_else(|p| p.into_inner());
    let resultado = match versiones.get_mut(&path) {
        Some(version) => {
            *version += 1;
            notificar(
                &proceso,
                "textDocument/didChange",
                json!({"textDocument": {"uri": uri, "version": *version}, "contentChanges": [{"text": text}]}),
            )
        }
        None => {
            versiones.insert(path, 1);
            notificar(
                &proceso,
                "textDocument/didOpen",
                json!({"textDocument": {"uri": uri, "languageId": "typst", "version": 1, "text": text}}),
            )
        }
    };
    resultado.map_err(fallo)
}

/// Lleva la vista al lugar del documento que sale de esa línea y columna del código (desde 1).
#[tauri::command(async)]
pub fn typst_live_reveal(key: String, path: String, line: u32, column: u32) -> Result<(), Value> {
    let proceso = vivo(&key)?;
    let archivo = ruta_dentro(&proceso.root, &path).map_err(fallo)?;
    pedir(
        &proceso,
        "workspace/executeCommand",
        json!({
            "command": "tinymist.scrollPreview",
            "arguments": [TAREA_DE_LA_VISTA, {
                "event": "panelScrollTo",
                "filepath": archivo,
                "line": line.saturating_sub(1),
                "character": column.saturating_sub(1),
            }],
        }),
    )
    .map(|_| ())
    .map_err(fallo)
}

/// El editor de ese archivo se cerró: Tinymist vuelve a leerlo del disco.
#[tauri::command(async)]
pub fn typst_live_close_doc(key: String, path: String) -> Result<(), Value> {
    let Ok(proceso) = vivo(&key) else {
        return Ok(());
    };
    let abierto = proceso
        .versiones
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(&path)
        .is_some();
    if !abierto {
        return Ok(());
    }
    let uri = uri_dentro(&proceso.root, &path).map_err(fallo)?;
    notificar(
        &proceso,
        "textDocument/didClose",
        json!({"textDocument": {"uri": uri}}),
    )
    .map_err(fallo)
}

/// Apaga la vista de un árbol. Sin `key`, todas las de `session`; sin los dos, todas.
#[tauri::command(async)]
pub fn typst_live_stop(key: Option<String>, session: Option<String>) {
    // Un arranque en curso termina antes: si no, insertaría su proceso después de este apagado.
    let _arranque = ARRANQUE.lock().unwrap_or_else(|p| p.into_inner());
    let claves: Vec<String> = PROCESOS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .keys()
        .filter(|k| match (&key, &session) {
            (Some(key), _) => *k == key,
            (None, Some(session)) => k.split('/').nth(1) == Some(session.as_str()),
            (None, None) => true,
        })
        .cloned()
        .collect();
    for k in claves {
        detener(&k);
    }
}

fn vivo(key: &str) -> Result<Arc<Proceso>, Value> {
    PROCESOS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(key)
        .cloned()
        .ok_or_else(|| fallo(format!("sin vista: {key}")))
}

fn sigue_vivo(proceso: &Proceso) -> bool {
    proceso
        .child
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .try_wait()
        .is_ok_and(|s| s.is_none())
}

// Tramo a tramo: en Windows la ruta sale con `\` en todo el camino, como la conoce Tinymist.
fn ruta_dentro(root: &Path, path: &str) -> Result<PathBuf, String> {
    if !path.to_ascii_lowercase().ends_with(".typ") {
        return Err(format!("no es typst: {path}"));
    }
    let mut destino = root.to_path_buf();
    for c in Path::new(path).components() {
        let Component::Normal(tramo) = c else {
            return Err(format!("fuera del árbol: {path}"));
        };
        destino.push(tramo);
    }
    Ok(destino)
}

fn uri_dentro(root: &Path, path: &str) -> Result<String, String> {
    let destino = ruta_dentro(root, path)?;
    Url::from_file_path(&destino)
        .map(|u| u.to_string())
        .map_err(|_| format!("ruta sin URI: {}", destino.display()))
}

fn arrancar(
    app: &AppHandle,
    key: &str,
    tinymist: &Path,
    paquetes: Option<PathBuf>,
    root: &Path,
    main: &str,
) -> Result<Arc<Proceso>, String> {
    let cwd = tempfile::tempdir().map_err(|e| e.to_string())?;
    // proceso largo: a propósito. Vive lo que la vista; lo apagan `detener` o el cierre de su stdin.
    let mut command = Command::new(tinymist);
    crate::util::no_console_window(&mut command)
        .arg("lsp")
        .current_dir(cwd.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(paquetes) = paquetes {
        command.env("TYPST_PACKAGE_CACHE_PATH", paquetes);
    }
    let mut child = command.spawn().map_err(|e| format!("tinymist: {e}"))?;
    #[cfg(windows)]
    huerfanos::asignar(&child);
    let stdin = child.stdin.take().ok_or("sin stdin")?;
    let stdout = child.stdout.take().ok_or("sin stdout")?;
    let principal = root.join(main);
    let proceso = Arc::new(Proceso {
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        pendientes: Mutex::new(HashMap::new()),
        siguiente: AtomicU64::new(1),
        root: root.to_path_buf(),
        main: Mutex::new(main.to_string()),
        puerto: AtomicU16::new(0),
        versiones: Mutex::new(HashMap::new()),
        _cwd: cwd,
    });
    leer(app.clone(), key.to_string(), proceso.clone(), stdout);
    match iniciar(&proceso, root, &principal) {
        Ok(puerto) => {
            proceso.puerto.store(puerto, Ordering::Relaxed);
            Ok(proceso)
        }
        Err(e) => {
            let mut child = proceso.child.lock().unwrap_or_else(|p| p.into_inner());
            let _ = child.kill();
            let _ = child.wait();
            Err(e)
        }
    }
}

fn iniciar(proceso: &Proceso, root: &Path, principal: &Path) -> Result<u16, String> {
    let raiz = Url::from_directory_path(root)
        .map_err(|_| format!("raíz sin URI: {}", root.display()))?
        .to_string();
    pedir(
        proceso,
        "initialize",
        json!({
            "processId": std::process::id(),
            "rootUri": raiz,
            "workspaceFolders": [{"uri": raiz, "name": "tarea"}],
            "capabilities": {},
            "initializationOptions": {"compileStatus": "enable", "customizedShowDocument": true},
        }),
    )?;
    notificar(proceso, "initialized", json!({}))?;
    pedir(
        proceso,
        "workspace/executeCommand",
        json!({"command": "tinymist.pinMain", "arguments": [principal]}),
    )?;
    empezar_vista(proceso, principal)
}

fn cambiar_principal(proceso: &Proceso, principal: &Path) -> Result<(), String> {
    pedir(
        proceso,
        "workspace/executeCommand",
        json!({"command": "tinymist.doKillPreview", "arguments": [TAREA_DE_LA_VISTA]}),
    )?;
    pedir(
        proceso,
        "workspace/executeCommand",
        json!({"command": "tinymist.pinMain", "arguments": [principal]}),
    )?;
    let puerto = empezar_vista(proceso, principal)?;
    proceso.puerto.store(puerto, Ordering::Relaxed);
    Ok(())
}

fn empezar_vista(proceso: &Proceso, principal: &Path) -> Result<u16, String> {
    let vista = pedir(
        proceso,
        "workspace/executeCommand",
        json!({
            "command": "tinymist.doStartPreview",
            "arguments": [[
                "--task-id", TAREA_DE_LA_VISTA,
                "--data-plane-host", "127.0.0.1:0",
                "--partial-rendering", "true",
                "--no-open",
                principal,
            ]],
        }),
    )?;
    vista["staticServerPort"]
        .as_u64()
        .and_then(|p| u16::try_from(p).ok())
        .ok_or_else(|| format!("doStartPreview sin puerto: {vista}"))
}

fn detener(key: &str) {
    let Some(proceso) = PROCESOS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(key)
    else {
        return;
    };
    let _ = pedir_con_plazo(&proceso, "shutdown", Value::Null, PLAZO_APAGADO);
    let _ = notificar(&proceso, "exit", Value::Null);
    let mut child = proceso.child.lock().unwrap_or_else(|p| p.into_inner());
    let limite = std::time::Instant::now() + PLAZO_APAGADO;
    while std::time::Instant::now() < limite {
        if child.try_wait().is_ok_and(|s| s.is_some()) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn escribir(proceso: &Proceso, mensaje: Value) -> Result<(), String> {
    let cuerpo = serde_json::to_vec(&mensaje).map_err(|e| e.to_string())?;
    let mut stdin = proceso.stdin.lock().unwrap_or_else(|p| p.into_inner());
    write!(stdin, "Content-Length: {}\r\n\r\n", cuerpo.len()).map_err(|e| e.to_string())?;
    stdin.write_all(&cuerpo).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

fn notificar(proceso: &Proceso, method: &str, params: Value) -> Result<(), String> {
    escribir(
        proceso,
        json!({"jsonrpc": "2.0", "method": method, "params": params}),
    )
}

fn pedir(proceso: &Proceso, method: &str, params: Value) -> Result<Value, String> {
    pedir_con_plazo(proceso, method, params, PLAZO_LSP)
}

fn pedir_con_plazo(
    proceso: &Proceso,
    method: &str,
    params: Value,
    plazo: Duration,
) -> Result<Value, String> {
    let id = proceso.siguiente.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    proceso
        .pendientes
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(id, tx);
    escribir(
        proceso,
        json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}),
    )?;
    let respuesta = rx.recv_timeout(plazo).map_err(|_| {
        proceso
            .pendientes
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&id);
        format!("{method}: sin respuesta en {} s", plazo.as_secs())
    })?;
    match respuesta.get("error") {
        Some(error) => Err(format!("{method}: {error}")),
        None => Ok(respuesta["result"].clone()),
    }
}

// Lee los mensajes de Tinymist hasta que cierra: respuestas a sus pendientes,
// peticiones suyas contestadas con `null`, errores y estado como eventos de la ventana.
fn leer(app: AppHandle, key: String, proceso: Arc<Proceso>, stdout: std::process::ChildStdout) {
    let raices = raices(&proceso.root);
    let _ = std::thread::Builder::new()
        .name("tinymist".into())
        .spawn(move || {
            let mut lector = BufReader::new(stdout);
            while let Some(mensaje) = siguiente_mensaje(&mut lector) {
                let id = mensaje.get("id").and_then(Value::as_u64);
                let method = mensaje.get("method").and_then(Value::as_str);
                match (id, method) {
                    (Some(_), Some(_)) => {
                        let _ = escribir(
                            &proceso,
                            json!({"jsonrpc": "2.0", "id": mensaje["id"], "result": Value::Null}),
                        );
                    }
                    (Some(id), None) => {
                        if let Some(tx) = proceso
                            .pendientes
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .remove(&id)
                        {
                            let _ = tx.send(mensaje);
                        }
                    }
                    (None, Some("textDocument/publishDiagnostics")) => {
                        let _ = app.emit(
                            "typst-live",
                            diagnosticos(&key, &mensaje["params"], &raices),
                        );
                    }
                    (None, Some("tinymist/compileStatus")) => {
                        let params = &mensaje["params"];
                        let _ = app.emit(
                            "typst-live",
                            Aviso {
                                key: key.clone(),
                                kind: "status",
                                path: None,
                                diagnostics: Vec::new(),
                                status: params["status"].as_str().map(str::to_owned),
                                pages: params["pageCount"].as_u64(),
                                line: None,
                                column: None,
                            },
                        );
                    }
                    (None, Some("tinymist/preview/scrollSource")) => {
                        if let Some(aviso) = salto(&key, &mensaje["params"], &raices) {
                            let _ = app.emit("typst-live", aviso);
                        }
                    }
                    _ => {}
                }
            }
        });
}

fn siguiente_mensaje(lector: &mut impl BufRead) -> Option<Value> {
    let mut largo = None;
    loop {
        let mut linea = String::new();
        if lector.read_line(&mut linea).ok()? == 0 {
            return None;
        }
        let linea = linea.trim_end();
        if linea.is_empty() {
            break;
        }
        if let Some((nombre, valor)) = linea.split_once(':') {
            if nombre.eq_ignore_ascii_case("content-length") {
                largo = valor.trim().parse::<usize>().ok();
            }
        }
    }
    let mut cuerpo = vec![0; largo?];
    lector.read_exact(&mut cuerpo).ok()?;
    serde_json::from_slice(&cuerpo).ok()
}

// LSP cuenta líneas desde 0 y columnas en UTF-16; el editor espera las dos desde 1.
fn diagnosticos(key: &str, params: &Value, raices: &[PathBuf]) -> Aviso {
    let archivo = params["uri"]
        .as_str()
        .and_then(|u| Url::parse(u).ok())
        .and_then(|u| u.to_file_path().ok());
    let path = archivo
        .as_ref()
        .and_then(|a| relativa(&a.to_string_lossy(), raices));
    let diagnostics = params["diagnostics"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|d| {
            let severidad = d["severity"].as_u64().unwrap_or(1);
            if severidad > 2 {
                return None;
            }
            let mensaje = d["message"].as_str().unwrap_or_default().to_string();
            let inicio = &d["range"]["start"];
            let linea = inicio["line"].as_u64().map(|l| l as u32 + 1);
            let columna = inicio["character"].as_u64().map(|c| c as u32 + 1);
            let lugar = match (&path, linea, columna) {
                (Some(p), Some(l), Some(c)) => Some((p.clone(), l, c)),
                _ => None,
            };
            let mensaje = match (&lugar, &archivo, linea, columna) {
                (None, Some(a), Some(l), Some(c)) => format!("{}:{l}:{c}: {mensaje}", a.display()),
                _ => mensaje,
            };
            Some(Diagnostico::de_lsp(severidad == 1, lugar, mensaje))
        })
        .collect();
    Aviso {
        key: key.to_string(),
        kind: "diagnostics",
        path,
        diagnostics,
        status: None,
        pages: None,
        line: None,
        column: None,
    }
}

// El doble clic en la vista: Tinymist da la ruta absoluta y la posición desde 0.
fn salto(key: &str, params: &Value, raices: &[PathBuf]) -> Option<Aviso> {
    let path = relativa(params["filepath"].as_str()?, raices)?;
    let inicio = params["start"].as_array()?;
    let fila = inicio.first()?.as_u64()?;
    let columna = inicio.get(1)?.as_u64()?;
    Some(Aviso {
        key: key.to_string(),
        kind: "jump",
        path: Some(path),
        diagnostics: Vec::new(),
        status: None,
        pages: None,
        line: u32::try_from(fila + 1).ok(),
        column: u32::try_from(columna + 1).ok(),
    })
}

#[cfg(windows)]
mod huerfanos {
    //! Un Job Object con `KILL_ON_JOB_CLOSE`: si la ventana muere, Windows cierra
    //! su asa y mata a los Tinymist que quedaran.
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    struct Trabajo(isize);
    static TRABAJO: OnceLock<Option<Trabajo>> = OnceLock::new();

    fn trabajo() -> Option<isize> {
        TRABAJO
            .get_or_init(|| unsafe {
                let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if job.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                (ok != 0).then_some(Trabajo(job as isize))
            })
            .as_ref()
            .map(|t| t.0)
    }

    pub fn asignar(child: &std::process::Child) {
        if let Some(job) = trabajo() {
            unsafe {
                AssignProcessToJobObject(
                    job as windows_sys::Win32::Foundation::HANDLE,
                    child.as_raw_handle() as windows_sys::Win32::Foundation::HANDLE,
                );
            }
        }
    }
}

// Lo que la vista usa de `environment/typst.rs`, que este build no compila.
const TOPE_DEL_MENSAJE: usize = 4_000;

#[derive(Serialize, Clone)]
pub struct Diagnostico {
    /// `"error"` | `"warning"`.
    severity: &'static str,
    /// Relativa a la carpeta de la tarea, con `/`. `None` sin lugar en la fuente.
    path: Option<String>,
    /// Desde 1.
    line: Option<u32>,
    /// Desde 1, en unidades UTF-16: las de CodeMirror y las del LSP.
    column: Option<u32>,
    message: String,
}

impl Diagnostico {
    /// Uno de Tinymist: el lugar ya resuelto a la carpeta de la tarea, o `None` y el lugar en el mensaje.
    pub fn de_lsp(error: bool, lugar: Option<(String, u32, u32)>, message: String) -> Self {
        let (path, line, column) = match lugar {
            Some((path, line, column)) => (Some(path), Some(line), Some(column)),
            None => (None, None, None),
        };
        Diagnostico {
            severity: if error { "error" } else { "warning" },
            path,
            line,
            column,
            message: recortar(message),
        }
    }
}

fn recortar(mut texto: String) -> String {
    if texto.len() > TOPE_DEL_MENSAJE {
        let mut corte = TOPE_DEL_MENSAJE;
        while !texto.is_char_boundary(corte) {
            corte -= 1;
        }
        texto.truncate(corte);
    }
    texto
}

fn raices(root: &Path) -> Vec<PathBuf> {
    let mut raices = vec![sin_verbatim(root)];
    if let Ok(canonica) = root.canonicalize() {
        raices.push(sin_verbatim(&canonica));
    }
    raices
}

fn sin_verbatim(path: &Path) -> PathBuf {
    let texto = path.to_string_lossy();
    PathBuf::from(texto.strip_prefix(r"\\?\").unwrap_or(&texto))
}

/// La ruta relativa a la carpeta de la tarea, con `/`; `None` si queda fuera de ella.
fn relativa(ruta: &str, raices: &[PathBuf]) -> Option<String> {
    if ruta.starts_with('@') {
        return None;
    }
    let limpia = sin_verbatim(Path::new(ruta));
    if !limpia.is_absolute() {
        let texto = limpia.to_string_lossy().replace('\\', "/");
        return Some(texto.strip_prefix("./").unwrap_or(&texto).to_string());
    }
    raices.iter().find_map(|raiz| {
        let dentro = limpia.strip_prefix(raiz).ok()?;
        let partes: Vec<_> = dentro
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        (!partes.is_empty()).then(|| partes.join("/"))
    })
}
