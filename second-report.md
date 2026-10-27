# Actualización QA macOS #405: funciona con límites; render remoto nativo sigue BLOQUEADO

Esta actualización sustituye la causa anterior «falta cuenta/fixture». Sí se montó una fixture sintética de cuenta con dos motores REALES del pin. No se consiguió el efecto final de render remoto, por lo que NO se afirma que #405 esté validado nativamente para tag.

## Resultados conservados

- `pnpm verify` sobre 5d80b92121920706cd6aeb4b0a043c840a91f416: PASS, 188 pasos, 0 SKIPPED, exit 0. No se repitió y no se atribuye a ec3d370.
- `pnpm window:build` sobre ec3d3703813d4ec92d94730ae215d5555f3bfd69: PASS. Build original con CSP de producto SHA-256 `6d06077257ddddbada15de4480176d731b19a280a6b57a651d8440713feb5d67`.
- macOS 26.6.2 (25G83), arm64 / Airm4. Sólo esta plataforma.

## Nuevas comprobaciones en build ORIGINAL sin modificar

1. Dos motores del lock, SHA-256 `6ecba03431f3ebb396f6d4a101c1b5e26fb041740d73f11b709978da3aba6f1d`, datos/home/maestra por FD desechables; control-plane y relay WebSocket sintéticos en loopback. B es otra máquina LÓGICA en la misma Mac, NO VM física.
2. Ambos completan `danil_connect_start`, aprobación sintética, online/account y `danil_workspace_set_account` del workspace `keep0001`. El pin emite `danil_client_token` con endpoint loopback. Compatibilidad comprobada, no supuesta.
3. CLI Claude sintético, basado en fixture upstream, genera una respuesta real almacenada por el motor con `::terminus-visual`. Archivos creados sólo en raíces desechables.
4. En ventana nativa original contra A, abrir tarea local muestra **HTML REAL ENGINE A** y **Contenido exclusivo del motor A**. PASS, captura `native-local-figure.png`.
5. Sustituir su HTML local por 26 MiB, cerrar/reabrir tarea: aviso **The visualization is too large to show in the chat.**, mantiene texto/nombre/Retry/Open in browser. PASS, captura `native-local-fallback2.png`.
6. Clic real **Open in browser** abre Safari `qa-figure.html`. AX del navegador confirma encabezado **LOCAL FALLBACK ENGINE A**. PASS de apertura externa LOCAL. Captura `native-local-browser.png` conserva URL del archivo; la imagen se tomó antes de su repintado completo, por lo que la confirmación del contenido es AX, no una imagen pintada del encabezado.
7. La ventana original NO puede listar la flota de loopback: consola WebKit muestra **Refused to connect to http://127.0.0.1:65457/v1/computers because it does not appear in the connect-src directive of the Content Security Policy.** Captura `native-csp-block.png`. No se modificó la CSP del producto.

## Variante de harness: alcance y resultado

Se conservó el ejecutable original. Se construyó variante nativa temporal desde el mismo SHA ec3d370 con ÚNICO cambio: añadir `http://127.0.0.1:* ws://127.0.0.1:*` a connect-src en un overlay de Tauri y en una copia temporal del `dist/index.html` generado. Hay dos CSP; el primer overlay solo de Tauri no bastó. La copia de `dist` conserva los mismos JS/CSS; no se sustituyó IPC ni lógica de router/lectura/render. Se usó frontendDist temporal y beforeBuildCommand null en el overlay final. SHA-256 final de variante: `8171511eb27ce864fd6032cf3a223df1ec75a98f90e32d84ab3e85455341b68b`.

Esta variante NO es la build original y sus resultados NO se atribuyen a producción con CSP intacta. Su finalidad era aislar el transporte de laboratorio sin relajar el producto.

- La ventana nativa muestra **HTML B / QA b**, una tarea real del motor B, mediante HTTP + WebSocket reales. PASS de descubrimiento/conexión.
- Al pulsar la tarea remota, el relay registra destino `cmp_bbbbbbbbbbbbbbbbbbbbbbbbbb`, workspace `keep0001`, argumentos del proyecto/sesión de B y `load_session`, `session_folder`, etc. No hay IPC mock/jsdom en este recorrido.
- **NO PASS del efecto final:** el chat remoto no llegó a mostrar la respuesta/figura. No se observa `chat_visual_part`/`tree_show` de la figura en el registro de relay. La adaptación de fixture registró respuestas hacia sockets cerrados (`OSError: [Errno 9] Bad file descriptor`) y algunas ventanas cerraron sin stderr. Se serializaron las llamadas del relay, pero no se obtuvo un resultado final estable. No se atribuye esta inestabilidad al fix de producto sin reproducción aislada.
- En la última corrida se mantuvo un proceso padre para observar ciclo de vida. `window-lifecycle.log` registra el PID de ventana; el cierre final lo hizo QA para limpiar el laboratorio. Las ventanas anteriores que cerraron antes no tienen causa establecida.

El motor B sí conserva respuesta/HTML exclusivo; se comprobó por RPC real `load_session` y `tree_show` (muestra **HTML REAL ENGINE B**) en la corrida v3. Eso acredita fixture/datos en B, NO render remoto nativo. La sesión de B no se copia a A.

## Apertura remota: aclaración de contrato

Deploy corrigió el brief inicial: el router existente rechaza `tree_open_external`/`open_file_external` de otra máquina con `machine_files` / `shell.machines.local_only`. Ese aviso es el resultado esperado, no se debe abrir navegador remoto ni relajar seguridad. Revisión estática confirma el límite en router.ts. Como la figura remota no llegó a renderizar, el clic remoto y su aviso no se ejecutaron: PENDIENTE, no PASS.

## Pendiente y dictamen

Falta estabilizar el relay sintético para devolver de forma fiable las respuestas reales de B y completar: render del archivo existente sólo en B sin cross_machine; lectura legacy/tree_show en el harness si se fuerza el error de comando en el relay; fallback remoto conservando local_only. No se hicieron esos efectos finales y no se deben inferir de los tests IPC simulados que ya pasaron.

**Dictamen: funciona con límites; requisito de figura remota nativa NO satisfecho. Este informe NO aprueba tag.** No merge/tag/release, no #407/#408, no cambios de producto ni delegación. Árbol fuente limpio en ec3d370. Motores/ventanas de QA detenidos al concluir.

## Reproducción y procedencia

Fuente leída puntualmente, sin clone: `danil-labs/seldon-host` dev, `scripts/e2e-account-spaces.py`, `scripts/fixtures/empty-task-cli.py`, `docs/connector.md` § Plano de control. Se accedió con `gh api repos/danil-labs/seldon-host/contents/<ruta>?ref=dev`. La fixture upstream es fuente privada y no se republica completa en este repositorio público. Sus hashes y los de la adaptación ejecutada están en `followup/source-hashes.txt`; Linux con acceso al repo puede obtenerla por el mismo comando.

Adaptaciones de harness: mantener vivos motores; emitir client-token sintético; responder listado de computadoras/CORS; sesión WebSocket con subprotocolo `danil.computers.v1`, call/result hacia Connection del motor B; serializar llamadas a cada Connection; loggear sólo método/ruta y comando/workspace/args (sin auth); crear tareas con CLI sintético; escribir HTML en exchange/visuals de cada tarea; selection.json privado para A. Se excluyeron por construcción del entorno de motores `SELDON_DANIL_MACHINE_FILE`, `SELDON_PROJECTS_DIR`, `SELDON_HEADLESS`, credenciales y variables de Terminus instalada. La ventana usa HOME nuevo; su env también se limpió explícitamente en el último lanzador.

Los logs publicados sustituyen rutas personales/internas por marcadores. No se publican selection/endpoint/master/tokens ni datos reales de cuentas. Los logs de fixture incluyen los errores completos de adaptación, sin convertirlos en defectos de producto.
