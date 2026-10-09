//! Cliente RPC1 sin arranque ni dependencia del motor. `probe` pregunta por un
//! descriptor conocido; la selección fija host, build y datos, y un cambio
//! requiere seleccionarlo de nuevo.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    time::Duration,
};
#[cfg(windows)]
mod windows;
use terminus_engine_protocol::{
    Endpoint, Error, Request, Response, Result, Selection, MAX_FRAME, PRODUCT, VERSION,
};

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
fn reply(response: Response) -> Result<Value> {
    match (response.result, response.error) {
        (Some(value), None) => Ok(value),
        (None, Some(error)) => Err(error),
        _ => Err(Error::new("invalid_request")),
    }
}

/// El descriptor y el `status` del motor que lo escribió, con las mismas
/// comprobaciones de archivo privado que la selección. `app_unavailable` si nadie escucha.
pub fn probe(endpoint_path: &Path) -> Result<(Endpoint, Value)> {
    let descriptor = private_file(endpoint_path)?;
    let endpoint: Endpoint = serde_json::from_slice(&descriptor.bytes)?;
    if endpoint.version != VERSION
        || endpoint.product != PRODUCT
        || endpoint.contract != contract()
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
        command: "status".into(),
        args: json!({}),
        request_id: uuid::Uuid::new_v4().to_string(),
    };
    let status = reply(exchange(&endpoint.address, &request, Duration::from_secs(3))?)?;
    if status["runtime"] != endpoint.runtime.as_str() || status["service"] != true {
        return Err(Error::new("version_mismatch"));
    }
    Ok((endpoint, status))
}

pub struct Client {
    selection: Selection,
    endpoint: Endpoint,
    selection_file: Snapshot,
    descriptor: Snapshot,
    credential: Snapshot,
    token: String,
    status: Value,
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
        };
        let status = client.request("status", None, json!({}), Duration::from_secs(3))?;
        if status["runtime"] != client.selection.runtime
            || status["product"] != PRODUCT
            || status["contract"] != client.selection.contract
            || status["service"] != true
            || status["protocol_version"] != VERSION
            || status["service_build"] != client.selection.service_build
            || status["data_directory"]
                != client.selection.data_directory.to_string_lossy().as_ref()
        {
            return Err(Error::new("version_mismatch"));
        }
        client.status = status;
        Ok(client)
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
        self.check_selection()?;
        if request.token != self.token || request.version != VERSION {
            return Err(Error::new("invalid_token"));
        }
        let response = exchange(&self.endpoint.address, request, timeout)?;
        self.check_selection().map_err(|_| Error::new("io"))?;
        reply(response)
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
        loop {
            let value = self.request_exact(&request, Duration::from_secs(30))?;
            if value["pending"] == true {
                if std::time::Instant::now() > deadline {
                    return Err(Error::new("io"));
                }
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            return Ok(value);
        }
    }
}
