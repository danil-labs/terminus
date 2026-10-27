# QA macOS PR #405 — funciona con límites; aprobación nativa remota BLOQUEADA

Fecha: 2026-10-27. Airm4, macOS 26.6.2 (25G83), arm64.

| Comprobación | SHA | Resultado |
|---|---|---|
| pnpm verify completo | 5d80b92121920706cd6aeb4b0a043c840a91f416 | PASS: exit 0, 188 pasos, 0 SKIPPED, 1116 s |
| pnpm window:build | ec3d3703813d4ec92d94730ae215d5555f3bfd69 | PASS: exit 0 |
| Abrir build nativa contra motor real desechable | ec3d3703813d4ec92d94730ae215d5555f3bfd69 | PASS: ventana PID 41158, ventana 19899, preparación 100 % |
| Clic nativo Next y efecto observado | ec3d3703813d4ec92d94730ae215d5555f3bfd69 | PASS: llega a Connect your AI |
| Figura HTML remota: lectura sin cross_machine y apertura externa | ec3d3703813d4ec92d94730ae215d5555f3bfd69 | BLOQUEADO: faltan cuenta Danil de laboratorio y máquina/tarea remotas reales con HTML |
| Figura local y fallbacks en ventana nativa | ec3d3703813d4ec92d94730ae215d5555f3bfd69 | PENDIENTE: no proveedor conectado, Continue deshabilitado; sin tarea/figura real |

El verify de 5d NO verifica ec3d. Se cambió de base por instrucción de deploy después de #406; git diff entre ambos SHA está vacío para readVisual.ts y chat-turn-unsaved.test.mjs. No se repitió verify Mac. No se incorporaron #407/#408.

La cadena incluye guards, compilación y empaquetado frontend/web, integración jsdom, rendimiento, cargo fmt/check/clippy/test y guard de permisos. Los escenarios de readChatVisual/openChatVisual verifican headers machine/workspace, lectura por partes, fallback tree_show y apertura local/remota con IPC SIMULADO. No equivalen a ventana nativa ni a relay/máquina reales. El defecto original no fue reproducido en ventana nativa; no se afirma ausencia nativa de cross_machine.

## Guion nativo realizado

1. En el repo existente: fetch origin main; checkout detached del SHA exacto ec3d370.
2. pnpm window:build (log completo incluido).
3. Copiar al laboratorio el motor arm64 ya comprobado por sidecar; su SHA coincide con lock: 6ecba03431f3ebb396f6d4a101c1b5e26fb041740d73f11b709978da3aba6f1d. La advertencia genérica de download --from dice local build, pero el hash comprueba que los bytes son los fijados.
4. node apps/desktop/scripts/engine.mjs start --lab <directorio desechable>; identidad ai.danil.seldon.dev, HOME/datos/recursos/ventana separados. Motor real, sin IPC simulado. El primer motor cerró su endpoint tras esperar sin clientes; se arrancó de nuevo al terminar la build.
5. Comprobar ventana por PID y capturar su contenido. Preparación All set 100 %.
6. AXPress Next; volver a observar ventana. Resultado Connect your AI, No AI connected yet, Continue deshabilitado. Captura native-onboarding.png.

Accesibilidad y Grabación de pantalla: terminus plugin check --id computer-use --json devolvió ready/accessibility/screen_recording true. SHA-256 del ejecutable construido: 6d06077257ddddbada15de4480176d731b19a280a6b57a651d8440713feb5d67.

## Impedimento y pendiente reproducible

Se requiere un laboratorio con proveedor listo (puede ser simulado si sólo genera el turno), cuenta Danil de prueba conectada, máquina remota real accesible y tarea remota real con directiva/HTML en su directorio de visuales. No se proporcionaron esas fixtures/cuentas y no se fabricaron registros ni se copiaron datos/credenciales de Terminus instalada. El alta limpia impide entrar al chat sin conectar un proveedor. Esto limita cobertura, no demuestra defecto del fix.

Con la fixture: abrir la tarea remota, comprobar render de HTML, forzar fallo de lectura para abrir el mismo archivo externamente y comprobar efecto de navegador/disco; repetir en local; para motor antiguo comprobar fallback real a tree_show. Esos efectos NO se ejecutaron aquí.

No aprobar tag basándose en este informe: falta el efecto remoto nativo requerido. No se hizo merge, tag, release ni delegación. El intento previo 3ndd5fwe recibió SIGTERM al inicio por motivo desconocido y NO cuenta como pass.

Los logs publicados son completos con rutas personales/internas sustituidas por marcadores. No se publican selection.json, endpoint, tokens ni datos de cuentas. engine.log y window.err quedaron vacíos. Capturas: ventana nativa de esta build, sin figura remota.
