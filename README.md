# QA macOS #405: funciona con límites — render remoto NATIVO acreditado

Este resultado sustituye el NO PASS remoto de los informes anteriores. No se repitió verify ni se cambió código/configuración del producto en git. No hubo merge, tag ni release.

## Identidad y alcance

- Plataforma: Airm4, macOS 26.6.2 (25G83), arm64.
- Cadena completa conservada: **5d80b92121920706cd6aeb4b0a043c840a91f416**, pnpm verify exit 0, **188 pasos, 0 SKIPPED**, 1116 s. Este resultado NO se atribuye a otro SHA.
- Ventana y código funcional: **ec3d3703813d4ec92d94730ae215d5555f3bfd69**, con los dos archivos del fix idénticos a 5d80b92. No verifica release PR #410/b79c9af ni su cadena.
- Build original con CSP intacta: SHA-256 `6d06077257ddddbada15de4480176d731b19a280a6b57a651d8440713feb5d67`. Local y apertura local probados en ella, como consta en el informe anterior.
- Render remoto: **variante NATIVA de harness**, SHA-256 `8171511eb27ce864fd6032cf3a223df1ec75a98f90e32d84ab3e85455341b68b`. Única diferencia respecto al código de ec3d370: HTTP/WS loopback añadido a connect-src mediante overlay temporal de Tauri y copia temporal del HTML generado. JS/CSS, router, readChatVisual/openChatVisual, IPC y componentes productivos sin reemplazar. El repositorio permanece limpio. El primer overlay sólo de Tauri no bastaba porque HTML lleva otra CSP.
- Motores A y B REALES del lock: SHA-256 `6ecba03431f3ebb396f6d4a101c1b5e26fb041740d73f11b709978da3aba6f1d`. En la corrida final A PID 64631 y B PID 64632. Datos, HOME, recursos y maestra por FD desechables; cuenta ficticia Persona QA. B es otra **máquina lógica en la misma Mac**, NO VM física. Plano de control, relay y proveedor son sintéticos. No hay jsdom ni IPC mock en el recorrido nativo.

## PASS: probe previo, sin Cocoa

Con RelaySession REAL de packages/computers/src/relay.ts y WebSocket global REAL de Node: **20 llamadas mezcladas/concurrentes**, cinco de cada load_session/list_live_sessions/list_projects/list_active_turns. Cada promesa comprobó el tipo/datos correspondientes; cada load_session devolvió ID/texto/directiva visual REALES de B. PASS tanto en v7b como en v8. Logs completos y probe propio publicados en esta evidencia.

El primer probe falló por argumento workspace omitido en list_active_turns y cleanup stop() en vez de close(); se corrigieron únicamente esos errores del probe y se conserva esa salida fallida.

La fuente previa usaba message como parámetro de consume, no como variable compartida del bucle. Se capturaron request/peer/target por defaults inmutables y se mantuvo serialización por Connection, pero **no se demostró enlace tardío como causa histórica**. La auditoría registra request id, comando, id de respuesta del motor, id reenviado e id de sesión de respuesta; sin auth.

## PASS: efecto final en ventana nativa

1. Abrir la variante nativa contra A con selección privada del laboratorio v8. API de cuenta/listado y sesión WebSocket reales hacia el servidor sintético; el servidor reenvía call/result a la Connection REAL de B.
2. Seleccionar space QA B. Crear adicionalmente en B una tarea **sin carpeta**, sesión `6wbq59m2`. El proveedor sintético genera la respuesta con directiva; el motor real la almacena. Escribir qa-figure.html exclusivamente en exchange/visuals de esa sesión en B. El archivo equivalente de esa sesión NO existe en A, comprobado en disco.
3. Abrir la tarea mediante **Open** en el detalle de la fila. La ventana real crea su pestaña, muestra máquina **QA b**, respuesta Figura de QA y el contenido **HTML REAL ENGINE B / Archivo exclusivo de B, tarea sin carpeta**. Captura `native-remote-pass-v8.png`, comprobada visualmente y por AX.
4. Relay audit: request `5d202f58-4f4c-46e7-859b-bd563c89660b`, comando **chat_visual_part**, respuesta del motor `0c6e17f6-1671-433a-b85d-b12eaaf8d1cf`, response id igual al request, value dict. La llamada pasó por el router productivo y llegó a B; ausencia de cabecera de máquina habría producido cross_machine antes de esa llamada. **No hubo cross_machine en la lectura lograda.**
5. Prueba de archivo: B existe, A no tiene archivo de esa sesión; SHA-256 del HTML pequeño `13827097cc41e8dd1ea959f1f13a4f211e0bd972b7f692ac07263d53a27642c0`. Detalle en remote-file-proof-v8.json.

## PASS: fallos previstos y recuperación

- Cambiar sólo el archivo de B a 26 MiB y cerrar/reabrir la pestaña: el motor real rechaza la lectura por tamaño. La ventana conserva respuesta, basename, aviso **The visualization is too large to show in the chat.**, Retry y Open in browser. Captura `native-remote-fallback-v8.png`.
- Clic nativo **Open in browser**: rechazo, visible **Could not open the visualization in the browser.**, sin envío tree_open_external a B. Captura `native-remote-local-only-v8.png`. El contrato estático del router corresponde a machine_files / shell.machines.local_only. **La interfaz no muestra ese código/frase específica y el detalle interno no se capturó en runtime**: no se afirma que local_only aparezca en pantalla. Se conserva el límite, no se abre navegador remoto ni se relajó seguridad.
- Restaurar el HTML pequeño en B y pulsar **Retry**: nueva chat_visual_part y AX vuelve a confirmar HTML REAL ENGINE B / Archivo exclusivo de B. PASS recuperación. La captura `native-remote-recovery-v8.png` se tomó con inspector parcialmente abierto y no muestra el encabezado pintado; la evidencia visual principal del render es native-remote-pass-v8.png. No se confunden modalidades.
- Local en build original, ya conservado: HTML REAL ENGINE A visible; aviso por 26 MiB; clic Open in browser abre Safari y AX confirma LOCAL FALLBACK ENGINE A.

## Lease y estabilidad de la fixture

La hipótesis de expiración NO explicó la corrida v7: B tenía PID/endpoint vivos y load_session respondió durante el intento GUI. Se añadió heartbeat local real cada 30 s para A y B, service invoke/list_live_sessions con workspace/proyecto correctos, sin passive:true. Registra PID/alive/value sin tokens. `heartbeat-v8.jsonl` cubre el periodo del render.

Se corrigió el registro sintético para conservar proyectos publicados (antes su PUT sólo contestaba), se dejaron tareas en sus spaces originales y se dieron nombres QA A/QA B. Se mantuvo un padre que espera la ventana para conservar código de salida. Estas son adaptaciones del laboratorio, no cambios del producto.

## Hallazgo separado: activación de fila mediante automatización

Pasos: en este harness nativo, activar por AXPress la fila de tarea remota (con o sin carpeta). Esperado: pestaña y chat permanecen abiertos. Observado: load_session retorna el ID correcto (audit de v7 y v8), pero termina en pantalla de conversación nueva. Abrir mediante botón **Open del detalle** sí mantuvo pestaña y renderizó el visual. Evidencia previa v7-remote.png/v8-render.png y actual v8b-open.png; se conserva la observación sin atribuirla a la correlación ni al lease. Requiere reproducir con interacción física antes de clasificarlo como defecto general del producto. No se corrigió. Este hallazgo no se usa como PASS de la activación directa de fila.

## Límites pendientes

- Relay/control-plane de PRODUCCIÓN y conexión entre computadoras físicas no comprobados. La CSP original deliberadamente no admite loopback; el harness sólo habilita el endpoint desechable en su variante. Esto no demuestra que la build original conecte a loopback (se probó que lo rechaza).
- Fallback de motor antiguo chat_visual_part -> tree_show pasó dentro de la cadena **con IPC simulado**; no se forzó en esta ventana nativa. No se declara PASS nativo de ese caso.
- Defecto original antes del fix no se reprodujo en ventana nativa: no se reconstruyó una variante sin #405.
- No se verificaron otras plataformas ni el SHA de la release posterior. La decisión de tag corresponde a deploy, no a esta tarea.

**Veredicto: funciona con límites. Lectura remota nativa del HTML exclusivo de B, error de tamaño y recuperación acreditados en ec3d370 + harness CSP; apertura remota conserva rechazo; local acreditado en la build original. Ya no queda el bloqueo técnico que impedía obtener el render remoto.**

## Evidencia y reproducción

Se conserva fuente privada upstream en su repositorio, no se republica: seldon-host dev, scripts/e2e-account-spaces.py, scripts/fixtures/empty-task-cli.py, docs/connector.md § Plano de control. Usar gh api con esos paths y ref dev. Hash de la adaptación ejecutada incluido. Sólo se publican adiciones propias del handler de correlación, heartbeat, probe Node y guion de la tarea raíz, con rutas sustituidas por marcadores.

Guion: arrancar fixture dual con dos motores del pin y selección privada A; ejecutar relay-probe.mjs (20/20) antes de GUI; mantener heartbeat.py; abrir variante CSP temporal contra selección A; QA B -> detalle de tarea raíz -> Open; comprobar chat_visual_part en auditoría y encabezado de B; cambiar tamaño del archivo B -> cerrar/reabrir -> abrir externo rechazado -> restaurar -> Retry. No copiar sesión/HTML de B a A. Env de motores se construye de cero; sin SELDON_DANIL_MACHINE_FILE/SELDON_PROJECTS_DIR/SELDON_HEADLESS. Ventana con HOME nuevo y esas tres variables retiradas. No se usaron datos/credenciales instalados.

Logs publicados completos, con rutas personales/internas sustituidas. No selection.json, endpoints con token_file, tokens, maestra ni credenciales reales. Se detienen motores/ventanas desechables al cerrar QA.
