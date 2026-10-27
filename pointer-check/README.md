# Chequeo focalizado con puntero físico — NO PASS

macOS 26.6.2 (25G83), arm64. Fuentes ec3d3703813d4ec92d94730ae215d5555f3bfd69, árbol limpio. Se reutilizó el build nativo del harness SHA256 8171511eb27ce864fd6032cf3a223df1ec75a98f90e32d84ab3e85455341b68b y el overlay CSP documentado en el informe anterior. No se repitió verify, build ni nodeprobe20. No se modificó producto ni instalación habitual.

Tras el corte por cuota, los motores anteriores habían terminado; la ventana restante mostraba engine not responding. Se reactivó el mismo harness en otro directorio desechable. Dos motores reales A/B en esta Mac, relay/control-plane sintéticos; no VM física ni IPC simulado. Heartbeat RPC local mantiene ambos activos. Ventana PID 83047, id 21079, frame x235 y84 1000x720; A PID82746, B PID82747.

## Reproducción una vez por fila remota

1. Abrir ventana contra A y seleccionar espacio QA B. La preparación Open Terminus/selector de espacio usó AXPress; las filas bajo prueba NO.
2. CuaDriver clic por coordenadas de captura nueva, delivery_mode foreground, route global_input: activa ventana exacta, mueve puntero y emite HID. Sin element_token, AXPress ni evaluate para la fila.
3. Fila sin carpeta: texto Figura remota B sin carpeta, screen point (344,328). B devolvió load_session wg04he46, request/response 5092c98c-d268-4d97-ae72-00a397d15cd7. Captura pointer-root-after: fila bajo cursor y hover con respuesta real, pero centro conversación nueva, sin pestaña/chat/figura. Después se observó seleccionado QA A; no se determinó la causa del cambio.
4. Control local A: clic HID en fila local con carpeta abrió pestaña/chat y HTML REAL ENGINE A. No se usa este control como PASS remoto.
5. Volver a QA B y clic HID sobre texto Muestra la figura HTML de QA, screen point (351,259). B devolvió load_session pxzed3kd, request/response 32433e8d-9248-42c7-bf6d-ee228179d0d9. pointer-b-project-after y snapshot registran QA B seleccionado y conversación nueva, sin figura ni pestaña de tarea B.

Ambos motores vivos con RPC de lectura exitoso durante el recorrido (heartbeat adjunto). IDs de respuesta coinciden con cada petición. Consola stdout/stderr de la ventana vacía, sin error/panic registrado; no se obtuvo consola interna WebKit, por lo que no se atribuye causa. No se pulsó Open alternativo para tapar estos fallos.

## Dictamen

FALLO reproducible del recorrido de apertura de fila remota con puntero físico en este harness nativo: la sesión correcta llega desde B pero no permanece abierta en chat. No es exclusivo de AXPress. La causa y si procede de producto o de otra condición del harness siguen sin determinarse; no se afirma regresión introducida por #405. El render/fallback remotos previamente acreditados por Open siguen válidos con sus límites, pero este pendiente NO está resuelto y QA no aprueba publicación/tag. Sin cambios, merge ni release.
