//! Sirve un `.html` de la carpeta de una tarea como página, con sus archivos
//! relativos: `terminus-page://localhost/<proyecto>/<tarea>/<árbol>/<ruta>`
//! (`http://terminus-page.localhost/…` en Windows). La raíz la da el motor
//! (`list_task_trees`), nunca el webview; fuera de ella no se lee nada.
//! Lo pinta `FileViewer.tsx` en un marco `sandbox="allow-scripts"`: origen opaco,
//! sin la app. La política de abajo deja cargar recursos de la red (una
//! presentación con reveal.js o fuentes de Google) pero no `fetch` fuera de aquí.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::http::{header, Response, StatusCode};
use tauri::Manager;

pub const SCHEME: &str = "terminus-page";

/// Las dos formas de su origen, como el IPC: macOS y Linux, Windows.
const ORIGEN: &str = "terminus-page: http://terminus-page.localhost";

/// Un video de una presentación cabe; un volcado de varios GB no se sube a memoria.
const TOPE_BYTES: u64 = 512 * 1024 * 1024;

/// Cuánto vale la raíz que dio el motor: una página pide decenas de archivos al cargar.
const VIGENCIA_RAIZ: Duration = Duration::from_secs(10);

fn politica() -> String {
    [
        "sandbox allow-scripts".to_string(),
        "default-src 'none'".to_string(),
        format!("script-src {ORIGEN} 'unsafe-inline' 'unsafe-eval'"),
        format!("style-src {ORIGEN} 'unsafe-inline'"),
        format!("font-src {ORIGEN} data:"),
        format!("img-src {ORIGEN} data: blob:"),
        format!("media-src {ORIGEN} data: blob:"),
        // Sólo su carpeta: nada de la red, ni para cargar ni para enviar.
        format!("connect-src {ORIGEN}"),
        format!("frame-src {ORIGEN}"),
        format!("worker-src {ORIGEN} blob:"),
        format!("base-uri {ORIGEN}"),
        "form-action 'none'".to_string(),
        "object-src 'none'".to_string(),
    ]
    .join("; ")
}

fn tipo_de(path: &Path) -> &'static str {
    match crate::util::ext_of(path).as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" | "cjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "txt" | "md" | "csv" | "tsv" => "text/plain; charset=utf-8",
        "xml" => "application/xml",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "wav" => "audio/wav",
        "wasm" => "application/wasm",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

/// Un tramo de ruta que no puede salir de su carpeta: ni `..`, ni separadores
/// escondidos tras `%2F`, ni `C:` o `a:b` (unidad o flujo alterno en Windows).
fn tramo(crudo: &str) -> Option<String> {
    let t = crate::util::decodificar(crudo)?;
    let valido = !t.is_empty()
        && t != "."
        && t != ".."
        && !t.contains(['/', '\\', ':'])
        && !t.chars().any(|c| c.is_control());
    valido.then_some(t)
}

struct Pedido {
    project: String,
    session: String,
    tree: String,
    rel: Vec<String>,
}

fn pedido_de(uri_path: &str) -> Option<Pedido> {
    let mut partes = uri_path.trim_start_matches('/').split('/');
    let project = tramo(partes.next()?)?;
    let session = tramo(partes.next()?)?;
    let tree = tramo(partes.next()?)?;
    let rel = partes.map(tramo).collect::<Option<Vec<_>>>()?;
    (!rel.is_empty()).then_some(Pedido {
        project,
        session,
        tree,
        rel,
    })
}

type Raices = Mutex<HashMap<(String, String, String), (PathBuf, Instant)>>;

fn raices() -> &'static Raices {
    static R: OnceLock<Raices> = OnceLock::new();
    R.get_or_init(Default::default)
}

/// La carpeta del árbol, canónica, como la dice el motor.
fn raiz_de(app: &tauri::AppHandle, p: &Pedido) -> Option<PathBuf> {
    let clave = (p.project.clone(), p.session.clone(), p.tree.clone());
    if let Some((raiz, cuando)) = raices().lock().ok()?.get(&clave) {
        if cuando.elapsed() < VIGENCIA_RAIZ {
            return Some(raiz.clone());
        }
    }
    let state = app.try_state::<Arc<super::proxy::State>>()?;
    let arboles = super::proxy::invoke(
        &state,
        "list_task_trees",
        json!({"project": p.project, "session": p.session}),
    )
    .ok()?;
    let ruta = arboles
        .as_array()?
        .iter()
        .find(|a| a["key"] == p.tree.as_str())?["path"]
        .as_str()?
        .to_string();
    let raiz = std::fs::canonicalize(ruta).ok()?;
    if let Ok(mut r) = raices().lock() {
        r.insert(clave, (raiz.clone(), Instant::now()));
    }
    Some(raiz)
}

fn respuesta(estado: StatusCode, tipo: &str) -> tauri::http::response::Builder {
    Response::builder()
        .status(estado)
        .header(header::CONTENT_TYPE, tipo)
        // Guardar recarga el marco: lo que se sirve es siempre lo del disco.
        .header(header::CACHE_CONTROL, "no-store")
        .header("X-Content-Type-Options", "nosniff")
        // El marco es de origen opaco: sin esto no cargan un `type="module"` ni un `@font-face`.
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CONTENT_SECURITY_POLICY, politica())
}

fn falla(estado: StatusCode) -> Response<Vec<u8>> {
    respuesta(estado, "text/plain")
        .body(Vec::new())
        .unwrap_or_default()
}

/// `bytes=a-b`, `bytes=a-` o `bytes=-n`, sobre un archivo de `largo` bytes.
fn rango(valor: &str, largo: u64) -> Option<(u64, u64)> {
    let (desde, hasta) = valor.trim().strip_prefix("bytes=")?.split_once('-')?;
    if largo == 0 || desde.contains(',') || hasta.contains(',') {
        return None;
    }
    let (a, b) = match (desde.trim(), hasta.trim()) {
        ("", n) => (largo.saturating_sub(n.parse().ok()?), largo - 1),
        (a, "") => (a.parse().ok()?, largo - 1),
        (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.min(largo - 1)),
    };
    (a <= b && a < largo).then_some((a, b))
}

/// Fuera del hilo del webview: preguntar al motor y leer 26 MB lo congelarían.
pub fn atender(
    app: tauri::AppHandle,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let path = request.uri().path().to_string();
    let rango = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    std::thread::spawn(move || responder.respond(servir(&app, &path, rango.as_deref())));
}

fn servir(app: &tauri::AppHandle, uri_path: &str, pedido_rango: Option<&str>) -> Response<Vec<u8>> {
    let Some(pedido) = pedido_de(uri_path) else {
        return falla(StatusCode::BAD_REQUEST);
    };
    let Some(raiz) = raiz_de(app, &pedido) else {
        return falla(StatusCode::NOT_FOUND);
    };
    let destino = pedido.rel.iter().fold(raiz.clone(), |r, t| r.join(t));
    // Canónica: un enlace simbólico dentro de la carpeta no lleva fuera de ella.
    let Ok(destino) = std::fs::canonicalize(destino) else {
        return falla(StatusCode::NOT_FOUND);
    };
    if !destino.starts_with(&raiz) {
        return falla(StatusCode::FORBIDDEN);
    }
    let Ok(meta) = std::fs::metadata(&destino) else {
        return falla(StatusCode::NOT_FOUND);
    };
    if !meta.is_file() {
        return falla(StatusCode::FORBIDDEN);
    }
    let largo = meta.len();
    if largo > TOPE_BYTES {
        return falla(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let tipo = tipo_de(&destino);
    let Ok(mut archivo) = std::fs::File::open(&destino) else {
        return falla(StatusCode::NOT_FOUND);
    };

    // Un video se pide a tramos: sin `206` no se puede saltar a la mitad.
    if let Some(valor) = pedido_rango {
        let Some((a, b)) = rango(valor, largo) else {
            return respuesta(StatusCode::RANGE_NOT_SATISFIABLE, tipo)
                .header(header::CONTENT_RANGE, format!("bytes */{largo}"))
                .body(Vec::new())
                .unwrap_or_default();
        };
        let mut cuerpo = vec![0; (b - a + 1) as usize];
        if archivo.seek(SeekFrom::Start(a)).is_err() || archivo.read_exact(&mut cuerpo).is_err() {
            return falla(StatusCode::NOT_FOUND);
        }
        return respuesta(StatusCode::PARTIAL_CONTENT, tipo)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_RANGE, format!("bytes {a}-{b}/{largo}"))
            .body(cuerpo)
            .unwrap_or_default();
    }

    let mut cuerpo = Vec::with_capacity(largo as usize);
    if archivo.read_to_end(&mut cuerpo).is_err() {
        return falla(StatusCode::NOT_FOUND);
    }
    respuesta(StatusCode::OK, tipo)
        .header(header::ACCEPT_RANGES, "bytes")
        .body(cuerpo)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_ruta_no_sale_de_su_carpeta() {
        assert!(pedido_de("/p/s/t/diapositivas/a.html").is_some());
        assert!(pedido_de("/p/s/t/a%20b.html").is_some_and(|p| p.rel == ["a b.html"]));
        for malo in [
            "/p/s/t/../secreto",
            "/p/s/t/%2E%2E/secreto",
            "/p/s/t/a%2F..%2Fb",
            "/p/s/t/a%5Cb",
            "/p/s/t/C:/Windows",
            "/p/s/t/a//b",
            "/p/s/t/",
            "/p/s/t",
            "/p/s/t/a%ZZ",
        ] {
            assert!(pedido_de(malo).is_none(), "{malo}");
        }
    }

    #[test]
    fn los_rangos_se_leen_como_http() {
        assert_eq!(rango("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(rango("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(rango("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(rango("bytes=0-5000", 1000), Some((0, 999)));
        assert_eq!(rango("bytes=1000-", 1000), None);
        assert_eq!(rango("bytes=0-1,5-9", 1000), None);
        assert_eq!(rango("items=0-1", 1000), None);
    }
}
