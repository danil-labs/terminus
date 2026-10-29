# QA nativa en Windows: ventana adaptada al contrato de encargados v2

2026-10-28, Windows 11 Pro x64 (26200). Rama `feat/window-handler-contract-v2`
desde `a76aadd`, con los arreglos de esta QA encima.

## Banco

- Motor: seldon-host `dev` `0588aab`, `cargo build -p seldon-existing-runtime -j 1`
  (10 min 58 s, sin errores). SHA-256 de `seldon-runtime.exe`:
  `44b238ff8d592720182e3de555714eace51a86dd2ed6c22f92cfe05347f9ccdf`. Contrato
  `5096a84a…`, el mismo que vendoriza la ventana.
- Laboratorio: raíz de datos temporal fuera del repositorio, identidad
  `ai.danil.seldon.qa-daphne-<hex>`, `--adopt-existing`, `CREATE_NO_WINDOW` y
  `scripts/lab_vault.py` (`track()`) para borrar la maestra del llavero al salir.
  El entorno del motor quita `TERMINUS_*`, `CLAUDE_*`, `ANTHROPIC_*`,
  `SELDON_*`, `HARNESS_*` y `CLAUDECODE`; conserva el HOME real solo como
  proveedor. El lanzador de Claude del laboratorio retira `CLAUDE_CONFIG_DIR` y
  llama al `claude.exe` real (Claude Code 2.1.301, sesión de `~/.claude`), como
  en la tarea 20kqepm3. No se tocó `ai.danil.terminus`.
- Ventana: `pnpm window:build` (debug, front embebido) y
  `node scripts/engine.mjs select|window --lab <lab> --cdp-port 9477`. Se manejó
  por WebView2 CDP con eventos de ratón y teclado reales; cada ventana se cerró
  por su PID.
- Repositorio del laboratorio `team` con `scrum-master`
  (`permissions.ceiling: "ask"`, `tools: [edit, execute, read]`), `tracker`
  (`requires.tools` git y una herramienta ausente, `requires.network`), `memo`
  (`memory.store.slot`), `shell-only` (`tools: [execute]`) y una fuente adjunta
  con `shared-helper` (solo lectura).

## Recorridos

| # | Recorrido | Resultado | Evidencia |
|---|---|---|---|
| 1a | `scrum-master` con techo `ask` pide permiso | PASS | Gate «Aprobar acción · Bash necesita tu aprobación» con `echo permitido > qa-allow3.txt`; modo Manual. `Turn.ran.policy`: `mode=manual`, `approvals.edit/execute=per_call`, `provenance` `permissions.ceiling=ask`. Tarea `qb40wkrb`, `model=sonnet`; transcripción de Claude con `claude-sonnet-5-5`. |
| 1b | Cerrar la ventana por PID y reabrirla con la petición viva | PASS | Tras reabrir, la tarea muestra el mismo gate, recuperado con `pending_requests` (`state=waiting`, `revision=1`). |
| 1c | Permitir | PASS | El archivo no existía antes; tras «Aprobar y ejecutar» contiene `permitido`. Registro durable `sent`, `revision=2`; lista viva vacía. |
| 1d | Rechazar | PASS | «Denegar» → «1 permiso denegado», respuesta `DENEGADO`, `qa-deny3.txt` no existe. Registro `sent`, `revision=2`. |
| 2 | Turno rechazado por el motor (`handler_limit_unenforceable`) | PASS | `@shell-only` con Claude Sonnet: «Este proveedor no garantiza los límites del encargado. — Reintentar», con «Detalle para reportarlo» en JSON (`code`, `limits`, `policy`). Ningún texto de la página contiene `[object`. |
| 2b | Turno rechazado por cuarentena (`handler_definition_modified`) | PASS | «La carpeta del encargado cambió durante un turno: está en cuarentena. Restaura la carpeta o la persona ejecuta terminus handler release.» en `role=alert`, sin `[object`. |
| 3a | Cuarentena: aviso y liberación | PASS (tras arreglo) | `agent.md` de `shared-helper` cambió durante un turno (`sleep 40`) → `authority/handler-quarantine.json` con huella aprobada y observada. Aviso en el chat con la frase del catálogo. «Liberar cuarentena» → diálogo → «Cuarentena liberada.»; registro `{}`; el turno siguiente se admite y responde con Sonnet. Una segunda liberación dice «No había una cuarentena que liberar.» |
| 3b | Aprobaciones `requires` | PASS (tras arreglo) | `tracker`: «seldon-lab-missing-tool · Pedido, no concedido», «git · Pedido, no concedido», «example.invalid · Pedido, no gestionado». Aprobar `git` → «Aprobación guardada.» y «git · Aprobado» (`handler requests`: `approved`, `by: person`). Revocar → «Aprobación revocada.» y vuelve a «Pedido, no concedido». |
| 3c | Memoria | PASS | `scrum-master`/`tracker`: «Configuración de memoria: Por identidad», «0 notas · sin sincronización con la cuenta». `memo`: «Almacén externo solicitado: team-memory», «team-memory · Pedido, no concedido · Acceso pedido: write». Avisos del turno con el catálogo: «El almacén de memoria del encargado no está disponible…» y «Una herramienta pedida por el encargado no está en el PATH del turno. (seldon-lab-missing-tool)». |

## Defectos encontrados y corregidos

1. **Tildes perdidas** en `src/locales/es/chat.json` (`contin?a`, `almac?n`,
   `menci?n`). Corregido.
2. **Avisos de encargado sin traducir dentro de «Trabajo».** Las filas de
   sistema del turno pasan por `textoDeSistema` y mostraban la prosa que guarda
   el motor (por ejemplo «…no está en el PATH de este turno.»), no la del
   catálogo. Ahora usan `avisoDeEncargado`, el mismo que `prosaDelFallo`.
   Reproducido en la ventana antes del arreglo y comprobado después. Prueba en
   `tests/unit/turn-failure.test.ts`.
3. **El perfil del encargado se cerraba tras aprobar, revocar o liberar.**
   `identidadVisualDeLaCelda` era una función simple: releer la fila de la tarea
   tras la mutación volvía a disparar el efecto que cierra el perfil al cambiar
   de conversación. Ahora es un `createMemo`. Reproducido (aprobar y revocar
   cerraban el perfil) y comprobado después.
4. **El resultado de la operación se borraba al instante.** El memo
   `handlerPolicy` devolvía acciones nuevas al releer la lista de proyectos y el
   panel se reiniciaba. Ahora conserva las acciones mientras el `scope` no
   cambie. Reproducido (el texto de estado aparecía y desaparecía) y comprobado
   después.

## Pendiente o no comprobado

- **Modelo de la tarea del encargado.** Una mención crea la tarea del encargado
  con `model: null` si su perfil no fija modelo; Claude corre entonces con su
  predeterminado (`claude-opus-5-5` en esta cuenta), no con el Sonnet del
  compositor. Los recorridos 1 se repitieron con el modelo del perfil en Sonnet
  5.5. No se cambió: decide producto o el motor.
- La fila `handler_changed` del motor («Las instrucciones de … cambiaron desde
  el turno anterior») sigue en la prosa del motor; no está entre los avisos que
  traduce la ventana.
- Aprobación de un slot MCP (`mcp`, `accept-hints`) y memoria `in-doubt`,
  `legacy-by-name` o `synced-by-name`: no se montaron en el laboratorio.
- Codex no aparece como proveedor en el laboratorio; el rechazo se provocó con
  `shell-only`, que el motor rechaza con cualquier proveedor.
- Solo Windows; ni macOS ni Linux.
