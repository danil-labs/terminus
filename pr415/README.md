# QA nativo PR415 — PASS con límites de laboratorio

Candidato exacto 23d93884bd2c842e92d61e24467c7f704b967333, base ec3d370. macOS26.6.2 (25G83), arm64. Build SHA256 93c47b242a3042597e55d9bbbca3e7d9892f97f08813adb3370d21abdcc317a2. Árbol limpio. Front build y Tauri debug/no-bundle PASS (logs adjuntos); NO full verify nuevo, cadena a cargo de Deploy.

## Variante y aislamiento

Dos motores reales pinned0.2.73/3ecb9a7 en esta Mac, A/B lógicos, HOME/datos/master-fd desechables, heartbeat RPC local cada30s sin passive, relay/plano de control y proveedor sintéticos. Sin IPC mock, VM física, login nuevo, cambios de defaults ni datos instalados. Mismo overlay CSP de #405: connect-src añade HTTP/WS 127.0.0.1:* en Tauri y copia de index.html. JS/CSS productivos del candidato, router/componentes sin instrumentación. No se atribuye a build con CSP de producción.

## Secuencia

Laboratorio y ventana nuevos: sin caché previa de filas remotas ni pestaña B abierta. Onboarding y selección de espacio por AX; filas bajo prueba por clic físico HID de CuaDriver foreground/global_input, capturas nuevas, sin AXPress/evaluate para abrir filas. Un intento inicial activó ventana desde otro foreground y perdió selección B sin emitir load_session remoto: no cuenta como prueba y se conservan capturas iniciales. Se fijó foreground con System Events antes de seleccionar B; no se reinició ventana ni motor.

1. Primer clic efectivo sobre texto de raíz B (344,328): abre pestaña/transcripción y HTML REAL ENGINE B / Archivo exclusivo de B, tarea sin carpeta. Sesión kxszh4j8; load_session 13b834f9-f6b0-4902-8719-50ab526ff9c9. Capturas root-before-physical/root-after-physical y snapshots.
2. Primer clic efectivo sobre texto de tarea con carpeta B (351,259), pestaña/open nuevos: abre pestaña/transcripción, encabezado QA b / HTML B y HTML REAL ENGINE B / Contenido exclusivo del motor B. Sesión gsd8h6vg, proyecto pjb0e5ny; load_session afaaf410-92bd-4fc7-a7b5-33104caa1529. La vista persiste después de carga y durante pasos posteriores.
3. Reemplazar sólo HTML de B por26MiB, cerrar pestaña y reabrir fila físicamente: fallback visualization too large conservando pestaña/transcripción. Open in browser por AX rechaza con Could not open..., conforme límite remote local_only. Sin apertura externa remota.
4. Restaurar HTML original de B y Retry por AX: vuelve HTML REAL ENGINE B, pestaña/chat persisten.
5. Seleccionar QA A y clic físico en fila local: pestaña/transcripción y HTML REAL ENGINE A. No se repitió apertura externa local ni fallback local en este candidato; el fallback/Retry ejecutado es remoto.

## Evidencia y límites

Header visual QA b acreditado en captura/snapshot de proyecto, archivo exclusivo de B comprobado en metadata, auditoría real incluye load_session y chat_visual_part/correlación. No hay captura literal de headers IPC ni stack/eventos DOM pointerdown/up/click, abrirSesion, setSessionId o pestanas.open/active en inspector WebKit; no se deduce origen de load_session sólo del log. La acreditación es efecto visual nativo tras clic físico junto con contenido exclusivo B. No se inyectó instrumentación ni hizo build diagnóstico adicional. Heartbeat confirma ambos motores vivos; consola nativa stdout/stderr sin contenido.

PASS del recorrido nativo solicitado (raíz/proyecto remotos, persistencia, control local, fallback/Retry remoto), con estos límites. Esto resuelve el síntoma de fila que bloqueó QA en #405 en este candidato/laboratorio, no demuestra causa interna ni autoriza merge/tag/release. Full verify/arquitectura y decisión de release corresponden a responsables.
