//! Sirve a la ventana la imagen que la respuesta nombra por su ruta en disco
//! (`![x](/ruta.png)` → `convertFileSrc` en `src/ui/Markdown.tsx`).
//! Solo imágenes por extensión y sin candado por carpeta: las capturas también
//! viven en `/tmp`. Pintarlas no saca nada: `connect-src` no deja leerlas.

use std::path::Path;

use tauri::http::{header, Response, StatusCode};

pub const SCHEME: &str = "terminus-image";

const TOPE_BYTES: u64 = 25 * 1024 * 1024;

fn tipo_de(path: &Path) -> Option<&'static str> {
    Some(match crate::util::ext_of(path).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        // Un SVG cargado por `<img>` corre sin scripts ni referencias externas.
        "svg" => "image/svg+xml",
        _ => return None,
    })
}

/// La ruta absoluta local de la URL, o `None`. Una ruta de red (`//host`,
/// `\\host`) se rechaza: abrirla en Windows le manda la sesión a ese servidor.
fn ruta_de(uri_path: &str) -> Option<String> {
    let crudo = uri_path.strip_prefix('/').unwrap_or(uri_path);
    let ruta = decodificar(crudo)?;
    if ruta.chars().any(|c| c.is_control()) {
        return None;
    }
    let bytes = ruta.as_bytes();
    let unix = bytes.first() == Some(&b'/') && !matches!(bytes.get(1), Some(b'/' | b'\\'));
    let windows = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\');
    (unix || windows).then_some(ruta)
}

fn decodificar(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut salida = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let par = s.get(i + 1..i + 3)?;
            salida.push(u8::from_str_radix(par, 16).ok()?);
            i += 3;
        } else {
            salida.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(salida).ok()
}

fn respuesta(estado: StatusCode, tipo: &str, cuerpo: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(estado)
        .header(header::CONTENT_TYPE, tipo)
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        // Abierta como documento, la URL no corre nada.
        .header(
            header::CONTENT_SECURITY_POLICY,
            "sandbox; default-src 'none'",
        )
        .body(cuerpo)
        .unwrap_or_default()
}

/// Lee fuera del hilo del webview: una imagen grande lo congelaría.
pub fn atender(request: tauri::http::Request<Vec<u8>>, responder: tauri::UriSchemeResponder) {
    let path = request.uri().path().to_string();
    std::thread::spawn(move || responder.respond(servir(&path)));
}

fn servir(uri_path: &str) -> Response<Vec<u8>> {
    let falla = |estado| respuesta(estado, "text/plain", Vec::new());
    let Some(ruta) = ruta_de(uri_path) else {
        return falla(StatusCode::BAD_REQUEST);
    };
    let path = Path::new(&ruta);
    let Some(tipo) = tipo_de(path) else {
        return falla(StatusCode::FORBIDDEN);
    };
    let Ok(meta) = std::fs::metadata(path) else {
        return falla(StatusCode::NOT_FOUND);
    };
    if !meta.is_file() {
        return falla(StatusCode::FORBIDDEN);
    }
    if meta.len() > TOPE_BYTES {
        return falla(StatusCode::PAYLOAD_TOO_LARGE);
    }
    match std::fs::read(path) {
        Ok(bytes) => respuesta(StatusCode::OK, tipo, bytes),
        Err(_) => falla(StatusCode::NOT_FOUND),
    }
}
