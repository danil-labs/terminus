//! Una sola ventana por carpeta de datos: abrir Terminus otra vez muestra la que
//! ya existe. El plugin de Tauri no sirve: se identifica por `identifier`, que
//! comparten la app instalada y la del laboratorio.
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

const SHOW: &[u8] = b"terminus-show\n";
const OPEN: &str = "terminus-open ";
const OK: &[u8; 2] = b"ok";
/// Una ventana que sale ya no contesta: la que la reemplaza al reiniciar sigue sola.
static EXITING: AtomicBool = AtomicBool::new(false);

pub enum Claim {
    /// Esta es la primera; atiende a las siguientes.
    First(TcpListener),
    /// Otra ventana viva se mostró; esta sobra.
    Shown,
    /// No se pudo escuchar: sigue sin instancia única.
    Alone,
}

pub fn claim(window_data: &Path) -> Claim {
    let file = window_data.join("instance.port");
    let port = std::fs::read_to_string(&file)
        .ok()
        .and_then(|text| text.trim().parse::<u16>().ok());
    if port.is_some_and(asked_to_show) {
        return Claim::Shown;
    }
    let Ok(listener) = TcpListener::bind(("127.0.0.1", 0)) else {
        return Claim::Alone;
    };
    let Ok(address) = listener.local_addr() else {
        return Claim::Alone;
    };
    let _ = std::fs::write(&file, address.port().to_string());
    Claim::First(listener)
}

/// Un aviso pulsado lanza otro `terminus.exe`: le pasa la tarea a la ventana abierta.
pub fn open_notice(window_data: &Path, key: &str) -> bool {
    let port = std::fs::read_to_string(window_data.join("instance.port"))
        .ok()
        .and_then(|text| text.trim().parse::<u16>().ok());
    port.is_some_and(|port| ask(port, format!("{OPEN}{key}\n").as_bytes()))
}

fn asked_to_show(port: u16) -> bool {
    ask(port, SHOW)
}

fn ask(port: u16, message: &[u8]) -> bool {
    let address = ([127, 0, 0, 1], port).into();
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut answer = [0u8; 2];
    stream.write_all(message).is_ok() && stream.read_exact(&mut answer).is_ok() && &answer == OK
}

/// `show` recibe la tarea de un aviso pulsado, si la trae.
pub fn serve(listener: TcpListener, show: impl Fn(Option<String>) + Send + 'static) {
    let _ = std::thread::Builder::new()
        .name("instance".into())
        .spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let Ok(reader) = stream.try_clone() else {
                    continue;
                };
                let mut line = String::new();
                if BufReader::new(reader.take(256))
                    .read_line(&mut line)
                    .is_err()
                {
                    continue;
                }
                let key = match line.strip_suffix('\n') {
                    Some("terminus-show") => None,
                    Some(rest) => match rest.strip_prefix(OPEN) {
                        Some(key) => Some(key.to_owned()),
                        None => continue,
                    },
                    None => continue,
                };
                if EXITING.load(Ordering::SeqCst) {
                    continue;
                }
                show(key);
                let _ = stream.write_all(OK);
            }
        });
}

pub fn exiting() {
    EXITING.store(true, Ordering::SeqCst);
}

/// La ventana que iba a reemplazarla no arrancó: esta vuelve a contestar.
pub fn stay() {
    EXITING.store(false, Ordering::SeqCst);
}
