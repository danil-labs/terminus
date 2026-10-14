//! Una sola ventana por carpeta de datos: abrir Terminus otra vez muestra la que
//! ya existe. No se usa el plugin de Tauri porque se identifica por `identifier`,
//! que comparten la app instalada y la del laboratorio.
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

const SHOW: &[u8] = b"terminus-show\n";
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

fn asked_to_show(port: u16) -> bool {
    let address = ([127, 0, 0, 1], port).into();
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut answer = [0u8; 2];
    stream.write_all(SHOW).is_ok() && stream.read_exact(&mut answer).is_ok() && &answer == OK
}

pub fn serve(listener: TcpListener, show: impl Fn() + Send + 'static) {
    let _ = std::thread::Builder::new()
        .name("instance".into())
        .spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut greeting = [0u8; SHOW.len()];
                if stream.read_exact(&mut greeting).is_err() || greeting != SHOW {
                    continue;
                }
                if EXITING.load(Ordering::SeqCst) {
                    continue;
                }
                show();
                let _ = stream.write_all(OK);
            }
        });
}

pub fn exiting() {
    EXITING.store(true, Ordering::SeqCst);
}
