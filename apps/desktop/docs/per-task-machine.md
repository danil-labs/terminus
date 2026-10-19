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
  `add_workspace(name, folder?, provider?, remote?)`
  (`existing-runtime/src/workspace/workspaces.rs:1083`) llama a `create()`, que
  pone `id: free_id(...)` (`:336`); `free_id` usa `util::id_libre`
  (`existing-runtime/src/util.rs:454-461`) sobre `short_id()`
  (`existing-runtime/src/util.rs:268-276`): 40 bits de un UUID v4 en base32.
- El id no se puede elegir: es también el nombre de la carpeta
  (`workspaces.rs:35`, `scope_dir` en `:243`), y `add_workspace` no lo recibe.
- El registro (`struct Workspace`, `workspaces.rs:34-105`) lleva `id`, `name`,
  `provider` y `remote` («la clave del workspace u organización en el
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

La ventana conserva **una** máquina activa, la que da los workspaces y los
proyectos (la de siempre). Las demás corren las tareas que se crearon en ellas.

1. **Enlace de workspaces y proyectos** (`src-tauri/src/extracted/fleet.rs`,
   `Fleet::workspace_on` y `project_on`). Por máquina: workspace de la ventana →
   el suyo, y `<workspace>/<proyecto>` → proyecto suyo. Si no hay enlace se
   busca, en este orden: el único workspace con el mismo `provider` + `remote`
   no vacíos, o el único con el mismo nombre; el proyecto, el único con el mismo
   nombre. Lo encontrado se guarda en `<window_data>/machines.json`, y ese
   archivo se puede editar a mano para fijar un enlace.
2. **Dueño de cada tarea.** `(workspace, tarea)` → máquina, en memoria, y
   reconstruido al arrancar desde la última lista guardada de cada máquina.
   La máquina activa no se apunta: lo que no tiene dueño va a ella.
3. **Encaminar por contrato** (`named_session`, `Fleet::target`). La tarea que
   nombra una orden se saca de sus parámetros en `commands.json` (`session`, o
   `id` + `project`), sin lista hecha a mano. Si su dueña es otra máquina,
   `Fleet::forward` traduce el workspace del sobre, `project` y `workspace` de
   los argumentos, y manda la orden a ese motor. Las órdenes con canal
   (`watch_task_tree`) abren el stream contra ese motor, y su corte
   (`unwatch_task_tree`) vuelve al mismo.
4. **Crear en otra máquina.** El selector «Ejecutar en» ya no cambia de motor:
   fija dónde nace la próxima tarea. `send_message` y `run_shell_command` de una
   tarea nueva llevan la cabecera `x-terminus-machine`, como ya se hacía con
   `x-terminus-workspace`. El proxy la crea allí y apunta la tarea nueva a esa
   máquina. Sin recarga y sin salir del workspace.
5. **Lista unida.** `list_live_sessions` de la máquina activa se completa con el
   de cada otra máquina que contesta, en el proyecto enlazado. Cada fila lleva
   `machine` y `machine_on`, y se intercala por `created_at` sin reordenar
   ninguna de las dos listas. `list_active_turns` y `list_live_turns` se unen
   igual, para que `reconcileActiveTurns` vea las tareas vivas remotas.
6. **Eventos de varias máquinas.** El sondeo principal sigue igual: un cursor
   y un `runtime`, los de la máquina activa. Cada otra máquina con este
   workspace enlazado tiene su propia suscripción en Rust (`side_feeds`), con
   `Feed` si anuncia `push_stream_v1` y con `service events` si no. Sus eventos
   `chat`, `session` y `question` se traducen a los ids de la ventana
   (`Fleet::localize`) y se emiten como eventos de Tauri, que llegan a los
   mismos oyentes (`lib/serviceEvents.ts`). Los de cuentas, agentes o atención
   no se reenvían: hablan de esa máquina, no de este workspace.
7. **Encender por intención.** Listar no enciende nada. Una máquina que no
   contesta aporta su última lista guardada con `machine_on: false`, y no se le
   vuelve a preguntar en 15 s. Una orden de `WAKES` sobre una tarea suya
   (enviar, responder un permiso, contestar una pregunta…) la enciende con su
   programa `wake` (`reach_waking`) y después la manda. Una lectura sobre una
   máquina apagada contesta `machine_off`.

## Lo implementado

- `src-tauri/src/extracted/fleet.rs`: enlaces, dueños, `target`, `forward`,
  `list`, `turns`, `merge` y `localize`, y la memoria en `machines.json`.
- `src-tauri/src/extracted/proxy.rs`:
  - `handle` lee `x-terminus-machine` y encamina con `routed`;
  - `gathered` une las listas;
  - `stream` recibe el motor de destino, y los vigilantes y streams recuerdan
    su motor;
  - `load_history` lee del motor dueño;
  - `service_filter` filtra también las suscripciones de las otras máquinas;
  - `side_feeds` / `side_feed` llevan sus eventos;
  - `reach` / `reach_waking` dan el motor de una máquina;
  - `machine_list` añade `linked`.
  - Se quitó `machine_select`: ya nada cambia el motor de la ventana.
- `src/features/machines/store.ts`: la lista de máquinas, `runOn` y la cabecera.
- `src/features/machines/MachinePicker.tsx`: elegir fija `runOn`, sin recarga;
  una máquina sin este workspace sale deshabilitada.
- `src/features/projects/Sessions.tsx`: chip con el nombre de la máquina en la
  fila de una tarea remota, atenuado si está apagada.
- `src/app/App.tsx`: las dos llamadas que crean tarea pasan `runOnOptions()`.
- Catálogos `shell.machines.unlinked`, `task_on` y `task_off` en `es` y `en`;
  `starting`, `active` y `failed` se borraron porque nadie los usa ya.
- Pruebas en `fleet.rs`, contra dos motores de laboratorio con ids distintos:
  - `two_engines_one_workspace`: lista unida, enlace por proveedor aunque el
    nombre se repita, `stop_turn` de una tarea remota con los ids de la VM,
    una tarea local que no se desvía, y crear en la máquina no activa sin que
    la activa reciba el `send_message`.
  - `asleep_machine_keeps_its_tasks_and_events_come_home`: con la máquina
    apagada y la ventana reabierta, la tarea sigue listada y encaminada; un
    evento remoto llega con los ids de la ventana; los eventos que no son de
    tarea, o de un workspace sin enlace, no pasan.

## Lo que queda

- **Radiant como identidad.** Enlazar por el id de Radiant necesita preguntar
  `radiant_governance_status` por cada workspace de cada máquina. Hoy se enlaza
  por `provider` + `remote` o por nombre único; si los nombres no coinciden, hay
  que fijarlo en `machines.json`. Falta una interfaz para enlazar a mano y para
  crear el workspace en la otra máquina si no existe.
- **Proyectos sin pareja.** Una tarea remota de un proyecto que la máquina
  activa no tiene no aparece, porque la lista va por los proyectos de la
  ventana. `move_session` hacia otro proyecto no traduce `to`.
- **Eventos.** La suscripción lateral empieza en el presente (`cursor: null`):
  lo emitido entre crear la tarea y suscribirse no llega en vivo; se recupera
  al releer la tarea con el evento `session` o al terminar el turno. Los lotes
  `catchup` y `resync` laterales se descartan.
- **Lecturas sobre una máquina apagada.** Abrir una tarea suya no la enciende:
  contesta `machine_off`. Hay que decidir si abrirla cuenta como intención.
- **Vista Typst en vivo** (`typst_live.rs`) y otras órdenes que el proxy llama
  por su cuenta con `proxy::invoke` siguen yendo a la máquina activa.
- **Cabecera de la tarea abierta.** El chip va en la fila; falta en la cabecera
  del chat.
- **Prueba en la ventana real.** jsdom no transporta cabeceras de `invoke`. Las
  pruebas cubren la lógica en Rust; falta un recorrido con dos motores de
  laboratorio y la ventana construida.
- **Transporte web.** El selector depende de que `invoke` pase `options.headers`
  tal cual. La rama del transporte web debe conservar eso o llevar la máquina
  de otra manera.

## Decisiones abiertas

1. ¿Abrir una tarea de una máquina apagada debe encenderla?
2. ¿Hace falta volver a poder cambiar el motor de toda la ventana (lo que hacía
   `machine_select`), o basta la máquina por tarea?
3. ¿Fallback por nombre, o exigir un enlace explícito o Radiant?
4. ¿«Ejecutar en» debe recordarse por workspace (hoy vale para toda la sesión
   de la ventana)?
