//! Cliente RPC1 sin arranque ni dependencia del motor. `probe` pregunta por un
//! descriptor conocido; la selección fija host, build y datos, y un cambio
//! requiere seleccionarlo de nuevo.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
mod link;
pub mod push;
#[cfg(windows)]
mod windows;
use link::{Failure, Link, Pushes};
use terminus_engine_protocol::{
    Endpoint, Error, Request, Response, Result, Selection, MAX_FRAME, PRODUCT,
    PUSH_STREAM_FEATURE, VERSION,
};

// Una conexión con más peticiones en vuelo que esto abre otra: pasadas 32 el
// motor deja de leer y una orden lenta frenaría a las demás.
const PER_LINK: usize = 16;
const MAX_LINKS: usize = 4;
// El motor cierra a los 120 s una conexión sin nada en vuelo ni suscripciones.
const LINK_IDLE: Duration = Duration::from_secs(90);
const RECHECK: Duration = Duration::from_secs(5);

pub fn contract() -> String {
    format!(
        "{:x}",
        Sha256::digest(terminus_engine_protocol::MANIFEST.as_bytes())
    )
}

struct Snapshot {
    path: PathBuf,
    bytes: Vec<u8>,
    device: u64,
    inode: u64,
}
fn private_file(path: &Path) -> Result<Snapshot> {
    if !path.is_absolute() {
        return Err(Error::new("invalid_request"));
    }
    let before = std::fs::symlink_metadata(path)?;
    if !before.is_file() || before.file_type().is_symlink() {
        return Err(Error::new("invalid_token"));
    }
    #[cfg(unix)]
    {
        use std::{
            fs::OpenOptions,
            os::unix::fs::{MetadataExt, OpenOptionsExt},
        };
        if before.uid() != unsafe { libc::geteuid() }
            || before.mode() & 0o077 != 0
            || before.nlink() != 1
        {
            return Err(Error::new("invalid_token"));
        }
        let mut options = OpenOptions::new();
        options.read(true).custom_flags(libc::O_NOFOLLOW);
        let file = options.open(path)?;
        let after = file.metadata()?;
        if before.dev() != after.dev()
            || before.ino() != after.ino()
            || after.uid() != unsafe { libc::geteuid() }
            || after.mode() & 0o077 != 0
            || after.nlink() != 1
        {
            return Err(Error::new("invalid_token"));
        }
        return read_snapshot(path, file, after.dev(), after.ino());
    };
    #[cfg(windows)]
    {
        let _ = before;
        let file = windows::open(path)?;
        let after = windows::identity(&file).ok_or_else(|| Error::new("invalid_token"))?;
        if after.directory || after.links != 1 || !windows::owned_exclusively(&file) {
            return Err(Error::new("invalid_token"));
        }
        read_snapshot(path, file, after.device, after.inode)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = before;
        Err(Error::new("unsupported"))
    }
}
fn read_snapshot(path: &Path, file: std::fs::File, device: u64, inode: u64) -> Result<Snapshot> {
    let mut bytes = Vec::new();
    file.take(MAX_FRAME + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FRAME {
        return Err(Error::new("invalid_request"));
    }
    Ok(Snapshot {
        path: path.to_owned(),
        bytes,
        device,
        inode,
    })
}
pub fn private_directory(path: &Path) -> Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(Error::new("invalid_request"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
            return Err(Error::new("invalid_request"));
        }
    }
    #[cfg(windows)]
    {
        let directory = windows::open(path)?;
        let opened = windows::identity(&directory).ok_or_else(|| Error::new("invalid_request"))?;
        if !opened.directory || !windows::owned_exclusively(&directory) {
            return Err(Error::new("invalid_request"));
        }
    }
    #[cfg(not(any(unix, windows)))]
    return Err(Error::new("unsupported"));
    Ok(())
}
/// Crea la carpeta si falta y la deja solo al usuario: `0700` en Unix; en Windows,
/// sin la herencia del perfil (`%LOCALAPPDATA%` puede conceder acceso a otros).
pub fn make_private_directory(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)?;
    let meta = std::fs::symlink_metadata(path)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err(Error::new("invalid_request"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(windows)]
    if private_directory(path).is_err() {
        windows::make_private(path)?;
    }
    private_directory(path)
}
fn unchanged(snapshot: &Snapshot) -> Result<()> {
    let current = private_file(&snapshot.path)?;
    if current.device != snapshot.device
        || current.inode != snapshot.inode
        || current.bytes != snapshot.bytes
    {
        return Err(Error::new("invalid_token"));
    }
    Ok(())
}

fn exchange(
    address: &std::net::SocketAddr,
    request: &Request,
    timeout: Duration,
) -> Result<Response> {
    let mut socket = TcpStream::connect_timeout(address, timeout.min(Duration::from_secs(3)))
        .map_err(|_| Error::new("app_unavailable"))?;
    socket.set_read_timeout(Some(timeout))?;
    socket.set_write_timeout(Some(timeout))?;
    let mut body = serde_json::to_vec(request)?;
    if body.len() as u64 >= MAX_FRAME {
        return Err(Error::new("invalid_request"));
    }
    body.push(b'\n');
    socket.write_all(&body).map_err(|_| Error::new("io"))?;
    let mut line = Vec::new();
    BufReader::new(socket.take(MAX_FRAME + 1)).read_until(b'\n', &mut line)?;
    if line.len() as u64 > MAX_FRAME {
        return Err(Error::new("response_too_large"));
    }
    let response: Response = serde_json::from_slice(&line)?;
    if response.version != VERSION || response.request_id != request.request_id {
        return Err(Error::new("version_mismatch"));
    }
    Ok(response)
}
fn announces_push(status: &Value) -> bool {
    status["service_features"]
        .as_array()
        .is_some_and(|features| features.iter().any(|f| f == PUSH_STREAM_FEATURE))
}
fn reply(response: Response) -> Result<Value> {
    match (response.result, response.error) {
        (Some(value), None) => Ok(value),
        (None, Some(error)) => Err(error),
        _ => Err(Error::new("invalid_request")),
    }
}

/// Una petición RPC1 suelta a una dirección local con su token, sin selección:
/// los servicios de 0.2.74 guardan el token dentro de su `endpoint.json`.
pub fn call(
    address: std::net::SocketAddr,
    token: &str,
    command: &str,
    args: Value,
    timeout: Duration,
) -> Result<Value> {
    if !address.ip().is_loopback() {
        return Err(Error::new("invalid_request"));
    }
    let request = Request {
        version: VERSION,
        token: token.to_owned(),
        workspace: None,
        folder: None,
        command: command.to_owned(),
        args,
        request_id: uuid::Uuid::new_v4().to_string(),
    };
    reply(exchange(&address, &request, timeout)?)
}

/// El descriptor y el `status` del motor que lo escribió, con las mismas
/// comprobaciones de archivo privado que la selección. `app_unavailable` si nadie escucha.
pub fn probe(endpoint_path: &Path) -> Result<(Endpoint, Value)> {
    let (endpoint, status) = request_endpoint(endpoint_path, "status", Duration::from_secs(3))?;
    if status["runtime"] != endpoint.runtime.as_str() || status["service"] != true {
        return Err(Error::new("version_mismatch"));
    }
    Ok((endpoint, status))
}

/// Una orden sin argumentos al motor que escribió el descriptor, con las comprobaciones de `probe`.
pub fn request_endpoint(
    endpoint_path: &Path,
    command: &str,
    timeout: Duration,
) -> Result<(Endpoint, Value)> {
    request(endpoint_path, command, timeout, true)
}

/// Lo mismo a un motor de otro contrato, el de la versión anterior tras actualizar:
/// solo para `status` y `service stop`, que no cambian entre contratos.
pub fn request_any_contract(
    endpoint_path: &Path,
    command: &str,
    timeout: Duration,
) -> Result<(Endpoint, Value)> {
    request(endpoint_path, command, timeout, false)
}

fn request(
    endpoint_path: &Path,
    command: &str,
    timeout: Duration,
    same_contract: bool,
) -> Result<(Endpoint, Value)> {
    let descriptor = private_file(endpoint_path)?;
    let endpoint: Endpoint = serde_json::from_slice(&descriptor.bytes)?;
    if endpoint.version != VERSION
        || endpoint.product != PRODUCT
        || (same_contract && endpoint.contract != contract())
        || !endpoint.address.ip().is_loopback()
    {
        return Err(Error::new("version_mismatch"));
    }
    let credential = private_file(&endpoint.token_file)?;
    let token = std::str::from_utf8(&credential.bytes)
        .map_err(|_| Error::new("invalid_token"))?
        .trim()
        .to_owned();
    let request = Request {
        version: VERSION,
        token,
        workspace: None,
        folder: None,
        command: command.into(),
        args: json!({}),
        request_id: uuid::Uuid::new_v4().to_string(),
    };
    let value = reply(exchange(&endpoint.address, &request, timeout)?)?;
    Ok((endpoint, value))
}

pub struct Client {
    selection: Selection,
    endpoint: Endpoint,
    selection_file: Snapshot,
    descriptor: Snapshot,
    credential: Snapshot,
    token: String,
    status: Value,
    push: bool,
    links: Mutex<Links>,
}

#[derive(Default)]
struct Links {
    pool: Vec<Arc<Link>>,
    backoff: Backoff,
    checked: Option<Instant>,
}

/// Espera entre conexiones fallidas: 100 ms que se doblan hasta 2 s.
#[derive(Default)]
pub(crate) struct Backoff {
    failures: u32,
    until: Option<Instant>,
}
impl Backoff {
    pub(crate) fn delay(&self) -> Duration {
        if self.failures == 0 {
            return Duration::ZERO;
        }
        Duration::from_millis(100 << self.failures.min(5).saturating_sub(1)).min(Duration::from_secs(2))
    }
    fn waiting(&self) -> bool {
        self.until.is_some_and(|until| Instant::now() < until)
    }
    pub(crate) fn fail(&mut self) {
        self.failures = self.failures.saturating_add(1);
        self.until = Some(Instant::now() + self.delay());
    }
    pub(crate) fn reset(&mut self) {
        *self = Self::default();
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        for link in self.links.lock().unwrap_or_else(|p| p.into_inner()).pool.drain(..) {
            link.close();
        }
    }
}
impl Client {
    pub fn select(path: &Path) -> Result<Self> {
        let selection_file = private_file(path)?;
        let selection: Selection = serde_json::from_slice(&selection_file.bytes)?;
        let descriptor = private_file(&selection.endpoint)?;
        let endpoint: Endpoint = serde_json::from_slice(&descriptor.bytes)?;
        if selection.version != VERSION
            || endpoint.version != VERSION
            || endpoint.product != PRODUCT
            || selection.contract != contract()
            || endpoint.contract != selection.contract
            || endpoint.runtime != selection.runtime
            || endpoint.data_directory != selection.data_directory
            || endpoint.token_file != selection.credential
            || !endpoint.address.ip().is_loopback()
            || selection.runtime.is_empty()
            || selection.service_build.is_empty()
            || !selection.data_directory.is_absolute()
            || !selection.window_data.is_absolute()
            || selection.window_data == selection.data_directory
        {
            return Err(Error::new("version_mismatch"));
        }
        let credential = private_file(&selection.credential)?;
        let token = std::str::from_utf8(&credential.bytes)
            .map_err(|_| Error::new("invalid_token"))?
            .trim()
            .to_owned();
        if token.is_empty() || token.len() > 4096 || token.chars().any(char::is_whitespace) {
            return Err(Error::new("invalid_token"));
        }
        let mut client = Self {
            selection,
            endpoint,
            selection_file,
            descriptor,
            credential,
            token,
            status: Value::Null,
            push: false,
            links: Mutex::default(),
        };
        let status = client.request("status", None, json!({}), Duration::from_secs(3))?;
        if !client.selected_engine(&status) {
            return Err(Error::new("version_mismatch"));
        }
        client.push = announces_push(&status);
        client.status = status;
        Ok(client)
    }
    fn selected_engine(&self, status: &Value) -> bool {
        status["runtime"] == self.selection.runtime
            && status["product"] == PRODUCT
            && status["contract"] == self.selection.contract
            && status["service"] == true
            && status["protocol_version"] == VERSION
            && status["service_build"] == self.selection.service_build
            && status["data_directory"] == self.selection.data_directory.to_string_lossy().as_ref()
    }
    /// Si el motor anunció `push_stream_v1`: conexión persistente, `service subscribe` y
    /// `service history`. Sin la marca, una conexión por petición como siempre.
    pub fn push_stream(&self) -> bool {
        self.push
    }
    pub fn status(&self) -> &Value {
        &self.status
    }
    pub fn runtime(&self) -> &str {
        &self.endpoint.runtime
    }
    pub fn selection(&self) -> &Selection {
        &self.selection
    }
    pub fn check_selection(&self) -> Result<()> {
        unchanged(&self.selection_file)?;
        unchanged(&self.descriptor)?;
        unchanged(&self.credential)
    }
    pub fn request(
        &self,
        command: &str,
        workspace: Option<String>,
        args: Value,
        timeout: Duration,
    ) -> Result<Value> {
        let request = Request {
            version: VERSION,
            token: self.token.clone(),
            workspace,
            folder: None,
            command: command.to_owned(),
            args,
            request_id: uuid::Uuid::new_v4().to_string(),
        };
        self.request_exact(&request, timeout)
    }
    pub fn request_exact(&self, request: &Request, timeout: Duration) -> Result<Value> {
        if self.push {
            return self.linked(request, timeout);
        }
        self.check_selection()?;
        if request.token != self.token || request.version != VERSION {
            return Err(Error::new("invalid_token"));
        }
        let response = exchange(&self.endpoint.address, request, timeout)?;
        self.check_selection().map_err(|_| Error::new("io"))?;
        reply(response)
    }

    /// Por una conexión ya validada. El par de un socket abierto no cambia: la
    /// selección se comprueba al abrir cada conexión y, como mucho, cada `RECHECK`.
    fn linked(&self, request: &Request, timeout: Duration) -> Result<Value> {
        if request.token != self.token || request.version != VERSION {
            return Err(Error::new("invalid_token"));
        }
        self.recheck()?;
        let mut retried = false;
        loop {
            let link = self.pooled()?;
            match link.call(request, timeout) {
                Ok(response) => return reply(response),
                // Lo que no llegó a salir se manda una vez más por otra conexión.
                Err(Failure::Unsent(_)) if !retried => {
                    link.close();
                    retried = true;
                }
                Err(Failure::Unsent(error) | Failure::Lost(error)) => return Err(error),
            }
        }
    }
    fn recheck(&self) -> Result<()> {
        let mut links = self.links.lock().unwrap_or_else(|p| p.into_inner());
        if links.checked.is_some_and(|at| at.elapsed() < RECHECK) {
            return Ok(());
        }
        if let Err(error) = self.check_selection() {
            for link in links.pool.drain(..) {
                link.close();
            }
            return Err(error);
        }
        links.checked = Some(Instant::now());
        Ok(())
    }
    fn pooled(&self) -> Result<Arc<Link>> {
        let mut links = self.links.lock().unwrap_or_else(|p| p.into_inner());
        links.pool.retain(|link| {
            let keep = link.is_open() && !(link.in_flight() == 0 && link.idle_for() > LINK_IDLE);
            if !keep {
                link.close();
            }
            keep
        });
        if let Some(link) = links.pool.iter().find(|link| link.in_flight() < PER_LINK) {
            return Ok(link.clone());
        }
        if links.pool.len() >= MAX_LINKS {
            if let Some(link) = links.pool.iter().min_by_key(|link| link.in_flight()) {
                return Ok(link.clone());
            }
        }
        if links.backoff.waiting() {
            return Err(Error::new("app_unavailable"));
        }
        match self.open_link(None) {
            Ok(link) => {
                links.backoff.reset();
                links.checked = Some(Instant::now());
                links.pool.push(link.clone());
                Ok(link)
            }
            Err(error) => {
                links.backoff.fail();
                Err(error)
            }
        }
    }
    /// Una conexión nueva al motor seleccionado: la selección sin cambios antes
    /// de mandar el token, y un `status` por ese socket que sea el mismo motor.
    pub(crate) fn open_link(&self, pushes: Option<Pushes>) -> Result<Arc<Link>> {
        self.check_selection()?;
        let link = Link::connect(&self.endpoint.address, pushes)?;
        let status = self.call_on(&link, "status", json!({}), Duration::from_secs(3));
        match status {
            Ok(status) if self.selected_engine(&status) && announces_push(&status) => Ok(link),
            Ok(_) => {
                link.close();
                Err(Error::new("version_mismatch"))
            }
            Err(error) => {
                link.close();
                Err(error)
            }
        }
    }
    pub(crate) fn call_on(
        &self,
        link: &Link,
        command: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<Value> {
        let request = Request {
            version: VERSION,
            token: self.token.clone(),
            workspace: None,
            folder: None,
            command: command.to_owned(),
            args,
            request_id: uuid::Uuid::new_v4().to_string(),
        };
        match link.call(&request, timeout) {
            Ok(response) => reply(response),
            Err(Failure::Unsent(error) | Failure::Lost(error)) => Err(error),
        }
    }
    pub fn invoke(
        &self,
        command: &str,
        workspace: Option<String>,
        arguments: Value,
    ) -> Result<Value> {
        let args = json!({"command":command,"arguments":arguments});
        let request = Request {
            version: VERSION,
            token: self.token.clone(),
            workspace,
            folder: None,
            command: "service invoke".into(),
            args,
            request_id: uuid::Uuid::new_v4().to_string(),
        };
        let deadline = std::time::Instant::now() + Duration::from_secs(3600);
        // Por una conexión abierta preguntar cuesta poco: se empieza pronto y se espacia.
        let mut wait = Duration::from_millis(if self.push { 25 } else { 200 });
        loop {
            let value = self.request_exact(&request, Duration::from_secs(30))?;
            if value["pending"] == true {
                if std::time::Instant::now() > deadline {
                    return Err(Error::new("io"));
                }
                std::thread::sleep(wait);
                wait = (wait * 2).min(Duration::from_millis(200));
                continue;
            }
            return Ok(value);
        }
    }
}
