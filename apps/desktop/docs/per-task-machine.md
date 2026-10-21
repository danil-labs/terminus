# Máquina por tarea

Hasta ahora, elegir otra máquina en «Ejecutar en» cambiaba el motor de la
ventana entera (`machine_select`) y recargaba la página: otros workspaces,
otras tareas, otro diario de eventos. Este documento recoge lo que se
investigó del motor, el diseño que deja a la persona en su workspace mientras
cada tarea corre en la máquina que la creó, lo implementado y lo pendiente.

Las referencias al motor son de `danil-labs/seldon-host` (privado), rama
`dev`, crate `existing-runtime`; se escriben `existing-runtime/src/...:línea`.

## Hallazgos

### 1. Identidad de un workspace entre máquinas

- Los ids de workspace son al azar y por máquina. No hay `create_workspace`:
  `add_workspace(name, folder?, git_host?, remote?)`
  (`existing-runtime/src/workspace/workspaces.rs:1083`) llama a `create()`, que
  pone `id: free_id(...)` (`:336`); `free_id` usa `util::id_libre`
  (`existing-runtime/src/util.rs:454-461`) sobre `short_id()`
  (`existing-runtime/src/util.rs:268-276`): 40 bits de un UUID v4 en base32.
- El id no se puede elegir: es también el nombre de la carpeta
  (`workspaces.rs:35`, `scope_dir` en `:243`), y `add_workspace` no lo recibe.
- El registro (`struct Workspace`, `workspaces.rs:34-105`) lleva `id`, `name`,
  `git_host` y `remote` («la clave del workspace u organización en el
  proveedor», `:72`), entre otros. `list_workspaces` (`:1064`) y
  `workspaces_startup` (`:862`) devuelven `{workspaces: [WorkspaceInfo], active}`
  con esos campos aplanados (`:124-150`).
- Radiant sí da un id estable entre máquinas: `RemoteWorkspace {id, name}`
  (`existing-runtime/src/workspace/radiant.rs:41-44`), guardado en
  `radiant.json` aparte (`radiant.rs:36`) y en `Governed.workspace_id`
  (`existing-runtime/src/workspace/governed.rs:36-62`). Pero solo se ve por
  `radiant_status` / `radiant_governance_status`, y solo del workspace del
  sobre (`radiant.rs:800`): no hay una lista id local → id Radiant.

Conclusión: el mismo workspace lógico tiene ids distintos en cada motor. Hace
falta un enlace que guarde la ventana.

### 2. Tareas y proyectos

- Los ids de tarea también salen de `short_id()`, sin comprobar choques
  (`existing-runtime/src/runtime/chat/launch.rs:98-106`). El propio motor
  estima unos 5·10⁻⁷ por cada mil tareas (`util.rs:262-267`). La clave segura
  es `(workspace, tarea)`.
- Los ids de proyecto son al azar y locales
  (`existing-runtime/src/workspace/projects.rs:262`); el proyecto vacío es
  «sin proyecto» (`existing-runtime/src/workspace/sessions.rs:1056`).
- Crear una tarea es `send_message` con `session: null`, que devuelve el id
  (`launch.rs:1046`); `run_shell_command` sin tarea devuelve `{session, turn}`;
  `create_agent_thread` devuelve el id (`sessions.rs:1873`).
- En `src-tauri/crates/engine-protocol/commands.json`, una orden nombra una
  tarea de dos formas: el parámetro `session` (48 órdenes, p. ej. `stop_turn`,
  `respond_permission`, `tree_*`, `watch_task_tree`) o `id` junto a `project`
  (22, p. ej. `load_session`, `rename_session`, `finish_task`,
  `task_history`). `mark_task_seen` y `list_active_turns` llevan además
  `workspace` en los argumentos.

### 3. Eventos y sobre

- Un solo diario por motor, con `seq` global
  (`existing-runtime/src/cli/service/events.rs:12-22`). `runtime` es un UUID
  por arranque del motor (`existing-runtime/src/cli/server.rs:46`): cursores de
  dos máquinas no se pueden mezclar.
- Los eventos `chat` llevan `session` y `workspace`, sin `project`
  (`existing-runtime/src/runtime/chat/events.rs:73-83`); el evento `session`
  lleva `{workspace, project, session}` (`server.rs:519`).
- El sobre de `service invoke` lleva el workspace aparte de los argumentos.
  Un motor que no conoce ese workspace contesta error y no cae en otro
  (`workspaces.rs:391-396`, `:443-453`).

## Diseño

La ventana conserva **una** máquina, la suya (la primera de la lista, `HOME` en
`proxy.rs`): da los workspaces y los proyectos y no cambia nunca. Las demás
corren las tareas que se crearon en ellas.

1. **Enlace de workspaces.** Todo pasa por una sola función,
   `Fleet::counterpart_workspace(machine, workspace)` en
   `src-tauri/src/extracted/fleet.rs`. Devuelve el workspace de esa máquina que
   corresponde al de la ventana:
   - el mismo id, si esa máquina lo lista: un workspace de la cuenta tiene el
     mismo id en todas ([`account-workspace.md`](account-workspace.md));
   - el enlace guardado a mano en `<window_data>/machines.json`
     (`workspaces.<máquina>.<workspace de la ventana>`), sin interfaz;
   - si no hay, el único workspace con el mismo `git_host` y `remote`, ambos no
     vacíos.

   Un nombre igual **no** enlaza: dos workspaces «Notas» de dos personas no son
   el mismo. Lo encontrado se guarda en el mismo archivo. Dentro de un
   workspace ya enlazado, el proyecto es el del mismo id o, si no, el de nombre
   único.
2. **Diseño de destino: el workspace de la cuenta.** El enlace dependerá de la
   cuenta del usuario, que Terminus aún no tiene. Funcionará como en Slack: uno
   inicia sesión, sus workspaces son de su cuenta y cada máquina materializa el
   mismo workspace con el id que la cuenta le da en el plano de control. Cuando
   exista, `counterpart_workspace` dejará de buscar y devolverá el workspace
   local cuyo id de cuenta coincide. Nada más del enrutado cambia. Por eso no
   hay interfaz para enlazar a mano.
3. **Dueño de cada tarea.** `(workspace, tarea)` → máquina. Vive en memoria y se
   reconstruye al arrancar desde la última lista guardada de cada máquina. Lo
   que no tiene dueño va a la máquina de la ventana.
4. **Encaminar por contrato** (`named_session`, `Fleet::target`). La tarea que
   nombra una orden se saca de sus parámetros en `commands.json`: `session`, o
   `id` + `project`. Si su dueña es otra máquina, `Fleet::forward` traduce el
   workspace del sobre y los `project`/`workspace` de los argumentos. Las
   órdenes con canal (`watch_task_tree`) abren el stream contra ese motor, y su
   corte vuelve al mismo.
5. **Crear en otra máquina.** «Ejecutar en» fija dónde nace la próxima tarea,
   **recordado por workspace** (preferencia `machines.run_on` de la ventana, en
   su `localStorage`, dentro de su carpeta de datos). `send_message` y
   `run_shell_command` de una tarea nueva llevan la cabecera
   `x-terminus-machine`. Una elección guardada cuya máquina ya no está o no
   tiene el workspace se ignora.
6. **Lista unida.** El `list_live_sessions` de cada otra máquina que contesta
   se intercala por `created_at`, con `machine` y `machine_on` por fila.
   `list_active_turns` y `list_live_turns` se unen igual. La fila y la cabecera
   del chat llevan `MachineChip`, atenuado si la máquina está apagada.
7. **Eventos.** El sondeo principal sigue con un cursor y un `runtime`, los de
   la máquina de la ventana. Cada otra máquina enlazada tiene su suscripción en
   Rust (`side_feeds`). Sus eventos `chat`, `session` y `question` se traducen a
   los ids de la ventana (`Fleet::localize`) y se emiten como eventos de Tauri,
   que llegan a los mismos oyentes.
8. **Abrir una tarea de una máquina apagada no falla.** `load_history` (y
   `load_session` con motores sin push) contestan, sin encender nada, lo último
   que se leyó de esa tarea con `offline: {machine}` (`Fleet::offline_task`).
   - **La copia** está en `<window_data>/machine-tasks/`: un archivo por tarea,
     como mucho 40 tareas y 2 MiB cada una; se borran las más viejas.
   - **Sin copia**, se contesta solo la fila: agente, modelo y ningún turno.
   - **En la ventana**, el chat avisa «<máquina> está apagada: se enciende
     cuando envíes un mensaje» (`shell.machines.asleep_notice`). Cuando la fila
     dice que la máquina ya contesta, la tarea se vuelve a leer de su motor.
9. **Encender por intención y entregar una vez** (`Fleet::deliver`,
   `State::wake_now`). Una orden de `WAKES` sobre una tarea remota prueba el
   motor que la ventana tenía. Si no contesta (`app_unavailable`, es decir, no
   llegó), lo enciende con su programa `wake`, espera a que conteste y manda la
   orden una sola vez. Si encender falla, no sale nada y se contesta
   `machine_off`.

   Mientras tanto el chat dice «Encendiendo <máquina>…»
   (`shell.machines.waking`). Al volver, la tarea se relee y la lista se
   refresca.
10. **Sin cambio de ventana.** `machine_select`, `State::select`, la recarga y el
    índice de máquina activa mutable se quitaron. La máquina de la ventana es la
    constante `HOME`.

## Lo implementado

- `src-tauri/src/extracted/fleet.rs`:
  - enlaces: `counterpart_workspace` y proyectos;
  - dueños de tareas;
  - enrutado: `target`, `forward`, `deliver`;
  - listas: `list`, `turns`, `merge`;
  - eventos: `localize`;
  - copia de tareas: `remember_task`, `offline_task`.
- `src-tauri/src/extracted/proxy.rs`:
  - enrutado en `handle` / `routed`, con entrega tras encender;
  - `gathered` une las listas;
  - streams y vigilantes recuerdan su motor;
  - `load_history` / `read_history` leen del motor dueño o dan la copia;
  - suscripciones laterales (`side_feeds` / `side_feed`);
  - `service_filter` también las filtra;
  - `reach` / `wake_now` dan el motor de una máquina;
  - `machine_list` añade `hosts` (si tiene el workspace abierto).
- Front:
  - `src/features/machines/store.ts`: lista, elección por workspace y cabecera;
  - `src/features/machines/MachinePicker.tsx`;
  - `src/features/machines/MachineChip.tsx`: el chip de la fila y la cabecera;
  - `src/app/App.tsx`: aviso de apagada o encendiéndose, relectura, cabecera;
  - `src/features/projects/Sessions.tsx`;
  - `Session.offline` en `src/features/chat/transcript.ts`.
- Catálogos `shell.machines.*` en `es` y `en`.
- Pruebas en Rust (`fleet.rs`), con motores de laboratorio de ids distintos:
  - `two_engines_one_workspace`: lista unida, orden remota con sus ids, crear
    en la máquina no activa;
  - `the_same_ids_are_the_same_workspace_and_project`: el mismo id gana a un
    enlace por remoto o por nombre;
  - `a_name_alone_does_not_link_a_saved_link_does`: un nombre igual no enlaza;
    un enlace guardado sí, aun con la máquina apagada;
  - `asleep_machine_keeps_its_tasks_and_events_come_home`: lista conservada
    entre sesiones y eventos traducidos;
  - `an_asleep_task_opens_from_its_last_copy`: copia o fila, copia acotada,
    nombres de archivo seguros;
  - `acting_on_an_asleep_task_wakes_it_and_sends_once`: se enciende una vez, se
    entrega una vez y no sale nada si no enciende.
- Prueba del front en `tests/unit/machine-task.test.mjs`: `dist/` en jsdom.
  Chip en fila y cabecera, la copia y el aviso al abrir, «Encendiendo vm…» al
  mandar, un solo `send_message`, relectura y ningún fallo.

## Llevar el trabajo

Elegir otra máquina en «Ejecutar en» para una carpeta de esta ventana lleva
también lo que no está en el remoto: commits sin push, cambios sin commit y,
si se eligen, archivos que git ignora. La ventana hace de puente entre los dos
motores con los comandos `work_*`; la orquestación es de `packages/carry`,
la comparten la web y el teléfono.

- Al enviar el primer mensaje, `features/machines/carry.ts` pregunta
  `work_status` al origen y si el destino tiene el proyecto. Sin nada que
  llevar y con el proyecto allá, se manda como siempre.
- Si no, `CarrySheet.tsx` deja elegir qué viaja; mientras tanto el origen ya
  exporta para decir el tamaño. El mensaje espera en la caja.
- Al enviar: `work_import {probe: true}` despierta el destino (está en `WAKES`
  de `proxy.rs`), se clona con `start_project_clone` si falta, se copian partes
  de 4 MiB y `send_message` crea la tarea con `baseRef` y `unwrapSnapshot`.
  `CarryProgress.tsx` pinta los pasos y, si se detiene, el arreglo; el mensaje
  vuelve a la caja y reintentar sigue desde la parte que faltaba.
- «Traer a esta Mac» (solo en el escritorio, que tiene motor local), en el
  encabezado de una tarea de otra máquina y en su menú: la misma hoja en modo
  traer. El origen es el worktree de la tarea (`work_status {task}`), nada
  ignorado sale marcado y `work_import {branchAs}` deja el trabajo en una rama
  de aquí sin tocar la carpeta. «Seguir en una tarea nueva aquí» abre un
  borrador sobre esa base con un resumen corto (título, último mensaje del
  agente y commits) y la tarea que nace enlaza a la original.
- Una carpeta sin remoto ya no deja fuera a las demás máquinas mientras la
  suya esté encendida: viaja entera (`full`) y `work_import {create}` crea allá
  el proyecto con el mismo id; `fleet.rs` deja pasar ese `project` sin
  traducir. El menú de la carpeta ofrece «Llevar a otra máquina…»: abre su
  tarea nueva en la máquina elegida y la hoja aunque no haya nada sin subir.
- Sellado: la web y el teléfono piden `work_key` al destino y mandan
  `recipientKey` en `work_export`; el archivo viaja cifrado para ese motor.
  La primera llave de cada máquina se fija en las preferencias
  (`machines.carry_keys`, TOFU); si cambia, la hoja lo avisa y no deja llevar
  hasta «Confiar en la nueva llave». El escritorio por el túnel SSH no sella.
- Web: la misma ventana por el relay, con partes de 512 KiB; los archivos que
  git ignora solo viajan sellados. Si la máquina de la carpeta está apagada,
  se avisa y se puede seguir sin el trabajo sin subir. `work_import` y
  `work_cancel` están en `INTENT_COMMANDS` (`packages/computers`); las partes no.
- Pruebas: `tests/unit/carry-work.test.ts` (orquestación contra dos motores
  falsos), `tests/unit/carry-window.test.mjs` (`dist/` en jsdom) y
  `tests/unit/web-carry.test.mjs` (`dist-web/` contra el relay falso).

## Lo que queda

- **El workspace de la cuenta**: `counterpart_workspace` y `project_on` ya
  prefieren el mismo id; falta dejar de guardar enlaces en `machines.json` cuando
  no queden workspaces de antes. Plan en [`account-workspace.md`](account-workspace.md).
- **Proyectos sin pareja.** Una tarea remota de un proyecto que la ventana no
  tiene no aparece. `move_session` hacia otro proyecto no traduce `to`.
- **Eventos.** La suscripción lateral empieza en el presente: lo emitido entre
  encender y suscribirse llega al releer la tarea. Los lotes `catchup` y
  `resync` laterales se descartan.
- **Otras lecturas** de una tarea apagada, como árbol, git o consumo, contestan
  `machine_off` como antes. No está comprobado cómo pinta ese error cada
  columna; la prueba del front las simula contestando.
- **Solo el envío avisa.** El aviso «Encendiendo…» sale al mandar un mensaje.
  Las demás órdenes de `WAKES` (permisos, preguntas) también encienden en el
  proxy, pero sin ese aviso.
- **Vista Typst en vivo** (`typst_live.rs`) sigue yendo a la máquina de la
  ventana.
- **Prueba con motores reales.** Falta un recorrido con dos motores de
  laboratorio y la ventana construida.
- **Transporte web.** El selector depende de que `invoke` pase
  `options.headers`.

## Decisiones tomadas

1. Abrir una tarea de una máquina apagada no la enciende. Se ve lo último leído
   con un aviso, y mandarle un mensaje la enciende.
2. Se quita para siempre el cambio de motor de toda la ventana.
3. El enlace es el mismo id de workspace (el de la cuenta); para los de antes,
   `git_host` + `remote` o un enlace guardado. No hay interfaz para enlazar.
4. «Ejecutar en» se recuerda por workspace.

## Con la cuenta de Danil

Con la sesión de Danil abierta (`danil_connect_status` = `connected`), la
ventana junta las tareas de todas las computadoras de la persona con las reglas
de la web (`src/web/fleet.ts` y `src/web/transport.ts`), en un trozo perezoso
(`src/features/machines/account.tsx`):

- El motor local sigue por el IPC nativo, con sus ids tal cual: eventos de
  Tauri, canales, lotes empujados y `load_history` paginado no cambian. Es la
  máquina `home` del `Fleet`: encabeza los workspaces que tiene.
- Cada otra computadora es una sesión del relay (`@terminus/computers`). Los
  workspaces y proyectos tienen el mismo id en todas y no llevan prefijo: un
  workspace es uno donde se liste su id y un proyecto es una fila con
  `machines`. Solo tareas, portafolios y cuentas de IA de las demás llevan el
  prefijo `cmp_x~`. Sus eventos llegan a los oyentes en cuanto
  llegan y sus huecos viajan en la siguiente página de `service_poll`.
- La credencial es un token de cliente de diez minutos que el motor pide al
  plano de control con su token de máquina (`account_relay_token` →
  `danil_client_token` → `POST /v1/computers/self/client-token`). Solo sirve
  para listar las computadoras de la persona y abrirles sesión; la ventana no
  guarda credenciales de Supabase.
- Sin cuenta, con un motor sin `danil_client_token`, con un plano de control
  sin tokens de cliente o sin otra computadora, no se instala nada.
- En una lectura de todas las máquinas, una remota que no contesta en seis
  segundos no aporta: las listas locales no esperan a la red.
- Al crear, «Ejecutar en» gana: la máquina elegida, si no la última usada, si no
  la de la ventana. Una máquina sin el workspace lo hace suyo con
  `materialize_workspace` antes de recibir la tarea; si su motor no conoce la
  orden, la máquina queda desactivada en «Ejecutar en» con la razón, igual que
  una carpeta sin remoto (`remote_url`) que vive en otra máquina.
- `attention` junta por workspace lo que dice cada máquina y llega a la ventana
  como una sola lista.
