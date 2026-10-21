# El workspace es de la cuenta; la máquina es de la tarea

**Estado:** PROPUESTA · 2026-10-20

**Reemplaza:** el enlace de workspaces de [`per-task-machine.md`](per-task-machine.md)
(«El workspace de la cuenta», en «Lo que queda») y «Usar este workspace aquí».

**Toca tres repositorios:** `danil-labs/computers` (plano de control),
`danil-labs/seldon-host` (motor) y `danil-labs/terminus` (escritorio, web y
móvil).

## Problema

En «Ejecutar en» eliges la VM y la tarea nace en la Mac. No es un descuido del
selector: el modelo está mal.

- **Cada motor tiene sus propios workspaces.** El id lo inventa cada máquina:
  `create()` usa `free_id` → `short_id()` (`existing-runtime/src/workspace/workspaces.rs:328-365`,
  `util.rs:283`). Ese id es también el nombre de la carpeta (`scope_dir`, `:244-249`).
- **«Usar este workspace aquí» crea otro workspace.** Hace `add_workspace({ name })`
  en la otra máquina y le copia los ajustes (`src/features/machines/workspace-here.ts:69,171`).
- **La ventana los junta por apariencia.** `Fleet.mergeWorkspaces` los agrupa por
  `provider` + `remote` o, si no hay, por nombre (`src/web/fleet.ts:247-294`). El
  móvil hace lo mismo (`packages/computers` `groupWorkspaces`).
- **Los proyectos no se juntan en la web.** Cada máquina lista los suyos con su id.
  `Fleet.decode` toma un id de proyecto sin prefijo como de la Mac
  (`src/web/fleet.ts:159`), y `route()` le da prioridad sobre la máquina elegida
  (`:183-187`). Por eso la tarea nace en la Mac. El proxy de Rust sí empareja
  proyectos por nombre (`src-tauri/src/extracted/fleet.rs:211`), así que hay dos
  reglas distintas para lo mismo.
- **Nadie sabe de quién es un workspace.** El plano de control no tiene tabla de
  workspaces, y el relay deja pasar el campo `workspace` sin revisarlo
  (`computers/src/protocol.ts:84-93`, `relay.ts:539-551`).

## Modelo

1. **Un workspace es uno solo y es de la cuenta de Danil.** Su registro vive en
   el plano de control. Cada máquina lo **materializa**: crea la carpeta y el
   `meta.json` con **el mismo id**. No hay mapa de ids por máquina, ni prefijos
   de workspace, ni uniones por nombre.
2. **Un proyecto es del workspace, con id estable.** Guarda su remoto y su rama
   base. La primera vez que una máquina corre una tarea de ese proyecto, lo clona.
   Un proyecto sin remoto (una carpeta local) se queda en su máquina, y la
   interfaz lo dice.
3. **La máquina es un dato de la tarea**, como el agente o el modelo. «Ejecutar
   en» siempre gana al crear. Después, cada orden va a la máquina dueña de la
   tarea.
4. **Lo que no es secreto se sincroniza; los secretos no salen de su máquina.**
   - Desde la cuenta: nombre, logo, idioma, idioma de salida, modo de permisos,
     tema de terminal, fondo del chat, catálogo de MCP y fuentes de skills.
   - Se quedan en cada máquina: la bóveda, los tokens de git host y las cuentas
     de agentes. Así lo pide la decisión de computadoras personales (§5).
5. **Sin cuenta de Danil, nada cambia.** Un workspace sin ligar sigue siendo local,
   como hoy.

Ya está decidido (2026-10-20) que cada workspace se liga a la cuenta y que el
relay rechaza los workspaces que no son de quien llama. Este modelo usa esa
decisión como base y le agrega la identidad compartida.

### Por qué el mismo id en todas las máquinas

Hay dos caminos:

- **El mismo id en todas las máquinas** (recomendado). El motor acepta un id dado
  en `add_workspace`.
  - Relay, espejo, `worktrees_root/<id>`, eventos y clientes ya hablan con el id
    del workspace. Con un solo id, todos quedan bien sin traducir nada.
  - Un workspace que ya existe en la Mac se liga **con su id actual**. No se
    mueve ni una carpeta.
  - Los ids siguen con el formato del motor (8 caracteres base32, por las rutas
    largas de Windows, `util.rs:277-282`). El plano de control garantiza que no
    se repitan con su llave primaria.
- **Un id de cuenta guardado en `meta.json`, con ids locales distintos.** Exige
  traducir en el relay, el espejo y cada cliente. Es lo que hay hoy, solo que
  con un enlace en vez de un nombre.

Con proyectos pasa lo mismo: el mismo id en todas las máquinas.

Las tareas sí conservan ids por máquina. Su dueña es la máquina que las creó, y
la fila lleva `machine`. Dentro de un workspace, `(máquina, tarea)` es la llave.

## Plan por repositorio

El orden importa: plano de control → motor → clientes. Cada paso se publica
detrás de lo que ya existe, sin romper a quien no lo usa.

### 1. `danil-labs/computers` — el registro y la regla

Sobre computers#10 (`feat/workspace-owners`); ver «Conciliación».

1. **Migración `005_workspaces.sql`**, aplicada a mano como las demás:
   - `workspaces`: `workspace_id` (el id del motor, llave primaria), `owner_id`,
     `name`, `radiant_workspace_id` (nulo si no es de organización), `settings
     jsonb`, `settings_version`, `created_at`, `updated_at`, `deleted_at`.
   - `workspace_projects`: `project_id`, `workspace_id`, `name`, `remote_url`
     (nulo si es carpeta local), `default_branch`, `home_computer_id` (la máquina
     de una carpeta local), fechas. Llave `(workspace_id, project_id)`.
   - RLS sin políticas, igual que `computers`: solo el rol de servicio.
2. **Rutas.** Aceptan JWT, token de cliente y token de máquina. Siempre filtran
   por `owner_id`.
   - `GET /v1/workspaces`: los workspaces de la persona, con sus proyectos.
   - `POST /v1/workspaces`: ligar o crear. Recibe el id que propone el motor;
     un id ocupado responde `409 workspace_id_taken`.
   - `PATCH /v1/workspaces/:id` (nombre y `settings` con `settings_version`;
     una versión vieja responde `409`) y `DELETE` (borrado suave).
   - `POST`, `PATCH` y `DELETE` en `/v1/workspaces/:id/projects[/:project]`.
3. **Relay.**
   - Toda llamada con `workspace` revisa que ese workspace sea del dueño de la
     sesión; si no, responde `workspace_forbidden`. Los workspaces sin ligar de
     la propia computadora se permiten **solo** con el token de esa máquina. Así
     no se rompe el escritorio.
   - Un evento nuevo, `workspace.changed {id, settings_version}`, llega a las
     máquinas conectadas de la persona para que relean.
   - `materialize_workspace` y `ensure_project` entran en `INTENT_COMMANDS`:
     encienden la VM.
4. **Pruebas:** una persona no ve ni llama los workspaces de otra; un id ocupado
   responde `409`; una versión vieja de ajustes responde `409`; la intención
   enciende y entrega una sola vez.

### 2. `danil-labs/seldon-host` — materializar con el id de la cuenta

Sobre seldon-host#72 (`feat/workspace-danil-link`); ver «Conciliación».

1. **Workspace con id dado.**
   - `add_workspace` recibe `id: Option<String>`. Lo valida con `safe_segment` y
     con el formato base32, y falla si `scope_dir(id)` ya existe.
   - `Workspace` gana `account: Option<String>` (el usuario de Danil, con
     `serde(default)`).
   - Órdenes nuevas:
     - `link_workspace`: liga un workspace local a la cuenta con su id actual,
       con `POST /v1/workspaces`, y sube sus proyectos y ajustes.
     - `materialize_workspace`: lo crea aquí con el id y los ajustes de la cuenta.
     - `unlink_workspace`.
2. **Proyecto portable.**
   - `project.json` guarda `remote_url` y `default_branch`, que hoy se calculan
     al listar (`projects.rs:602,623`). `clone_project` y `create_project` aceptan
     un id dado.
   - Orden nueva `ensure_project(project)`: si el proyecto no está aquí y tiene
     remoto, lo clona en `default_project_directory` con la cuenta de git host
     de esta máquina; si es carpeta local, responde `project_not_here`.
   - `send_message` y `run_shell_command` de una tarea nueva llaman a
     `ensure_project` antes de `prepare_cwd` (`launch.rs:1737`;
     `sessions.rs:1166-1172` hoy falla si no está la carpeta).
3. **Ajustes desde la cuenta.**
   - Los setters de `meta.json`, del logo, de `mcp.json` (solo el catálogo, sin
     credenciales) y de `skills/` publican con `PATCH`.
   - Al conectar y con `workspace.changed`, el motor relee y escribe en disco.
   - El fondo del chat pasa a ser del workspace (hoy es global de la máquina,
     `workspace/handlers.rs:1193`). Esto ya lo pide la decisión del 2026-10-20.
4. **Conector.** `hello` manda la lista de workspaces ligados de la máquina. El
   relay la usa para saber cuáles materializó cada una.
5. **Contrato.** Se agregan las órdenes nuevas y el campo `account` en
   `commands.json`. Sube la versión del contrato, y Terminus fija el motor nuevo.

### 3. `danil-labs/terminus` — una lista, una regla

1. **Lista de workspaces desde la cuenta.** Con sesión de Danil, la lista es
   `GET /v1/workspaces` más los workspaces locales sin ligar del motor de esta
   máquina.
   - Se borran `mergeWorkspaces`, el agrupado por nombre y los prefijos de
     workspace en `src/web/fleet.ts`.
   - Se borran `groupWorkspaces` en `packages/computers` y en el móvil
     (`apps/mobile/src/lib/workspaces.tsx:189`).
2. **Proyectos una sola vez.** El sidebar lista los proyectos de la cuenta, ya no
   la suma de cada máquina (`list_projects` en abanico). Una carpeta local muestra
   su máquina.
3. **Enrutado.**
   - Al crear: la máquina elegida, si no la última usada, si no la de la
     ventana.
   - Si la máquina no tiene el workspace, primero `materialize_workspace`;
     después `send_message`, y el motor resuelve el proyecto.
   - Todo lo demás va a la máquina dueña de la tarea.
   - `KEYS` solo traduce ids de tarea.
   - En Rust, `counterpart_workspace` y `project_on`
     (`src-tauri/src/extracted/fleet.rs:168,211`) devuelven el mismo id, y
     `machines.json` deja de guardar enlaces.
4. **«Ejecutar en».**
   - Ofrece todas las máquinas de la cuenta, sin el estado «sin enlazar».
   - Con un proyecto que es carpeta local de otra máquina, la opción se muestra
     desactivada con la razón.
   - Se borran `workspace-here.ts`, `HerePanel` y sus textos.
5. **Ligar.** En Configuración del workspace: «Ligar a mi cuenta de Danil» llama
   a `link_workspace`. Con sesión de Danil, el alta de un workspace nuevo lo liga
   desde el principio.
6. **Pruebas.**
   - Se reescriben `web-machines`, `machine-task`, `desktop-account-machines` y
     las de `fleet.rs`.
   - Se borra `web-workspace-here`.
   - Caso nuevo: con un proyecto de la Mac y la VM elegida, la tarea nace en la
     VM, con el mismo id de proyecto. Es el error de hoy.

## Migración de lo que ya existe

- **Workspaces de la Mac:** se ligan con su id actual y no se mueve nada.
- **Copias que creó «Usar este workspace aquí»** (otro id y el mismo nombre en la
  VM):
  - el motor de la VM gana `adopt_workspace(local, account)`, que renombra la
    carpeta al id de la cuenta;
  - antes de implementarlo hay que medir qué rutas absolutas guardan las tareas
    y los worktrees (`worktrees_root/<id>`), porque renombrar puede romperlas;
  - si las rompe, la copia vieja se queda como un workspace local de la VM,
    con sus tareas, y la nueva se materializa al lado.
- **Preferencias de la ventana:** `machines.run_on` se conserva, porque sus
  llaves ya son ids de workspace.

## Decisiones abiertas

1. **El mismo id en todas las máquinas o un id de cuenta con un mapa por
   máquina.** Recomiendo el mismo id; está razonado arriba.
2. **Carpetas locales sin remoto.** Propongo dejarlas fijas en su máquina y no
   sincronizar archivos.
3. **Conflictos de ajustes.** Propongo que gane la última escritura, con
   `settings_version`, y avisar cuando se rechaza una.
4. **Workspaces de organización con varias personas.** Este plan es de un solo
   dueño. Los miembros llegan con WorkOS o Radiant (decisión abierta 1 de
   `danil-workspace/docs/decisions/2026-10-19-personal-computers-architecture.md`).
   `radiant_workspace_id` deja la puerta abierta.

## Qué no cambia

- RPC1 sigue cerrado en el loopback de cada máquina; todo lo remoto pasa por el
  relay.
- Las cuentas de agentes, la bóveda y los tokens de git host no salen de su
  máquina.
- Un workspace sin cuenta de Danil funciona igual que hoy.

## Conciliación con los PRs de vínculos (2026-10-21)

Mientras se escribía este plan, otra tarea abrió computers#10, seldon-host#72 y
terminus#185: cada `(computadora, workspace)` atado a una cuenta de Danil, el
relay que lo hace cumplir, eventos con `workspace` y el fondo del chat por
workspace. La revisión encontró errores graves en los tres y un modelo que
permite varias personas por computadora. Este plan se construye **encima** de
esos PRs: se queda con lo que sirve, corrige sus errores y agrega el workspace
compartido. Las ramas nuevas salen de sus cabezas (fab9bd4, 696773f, 6d93c68).

Se conserva de esos PRs:

- `computer_workspace_links`: en qué computadoras vive cada workspace y de quién
  es. Hace el papel de `workspace_computers`.
- El error `workspace_not_linked` (reemplaza a `workspace_forbidden`) y el
  cierre 4003 `unlinked`.
- Computadoras compartidas: una persona que no es dueña de la computadora
  (miembro) puede tener ahí sus workspaces. Hay VMs compartidas
  (`vm-linux-shared`, `vm-windows-shared`).
- Las órdenes `danil_workspace_link{mode}` / `danil_workspace_unlink`, el campo
  `danil: {user_id, email, name}` de las filas (hace el papel de `account`) y
  `danil.json` en la carpeta del workspace.
- Eventos con `workspace` arriba, el filtro de la web por máquina remota
  (`linkedOnly`/`linkedEvents`) y el fondo del chat por workspace.

## Contrato entre los tres repositorios (fase 1, conciliado)

Esta sección es la fuente común de las tres implementaciones; si una necesita
cambiarla, se cambia aquí primero.

### Ids

- Formato del motor: 8 caracteres de `0123456789abcdefghjkmnpqrstvwxyz`
  (`util.rs` `short_id`). Expresión: `^[0-9a-hjkmnp-tv-z]{8}$`. Se valida en
  las tablas nuevas, en `computer_workspace_links` y en el Worker.
- Workspace y proyecto conservan su id en todas las máquinas. Las tareas
  siguen con id por máquina.

### Quién es dueño de qué

- **Un workspace tiene una sola dueña**: `workspaces.owner_id`. Toda fila de
  `computer_workspace_links` de ese workspace lleva `user_id = owner_id`; un
  intento de atarlo a otra persona responde `409 workspace_id_taken`.
- **La dueña de una computadora es la dueña por omisión de sus workspaces.** Al
  conectar, el motor ata a ella todo workspace local que no esté atado
  (`mode: owner`). Así una VM sin ventana nunca queda con workspaces invisibles
  y el despliegue no deja a nadie sin acceso.
- **Un miembro** (persona con workspaces en una computadora ajena) entra por el
  código de dispositivo de «Otra cuenta» de #10, que la dueña de la computadora
  inicia desde su máquina. Un miembro no materializa workspaces en esa
  computadora en la fase 1.

### Plano de control (`computers`)

Tablas en `public`, RLS sin políticas (solo rol de servicio):

- `workspaces(workspace_id text pk, owner_id text not null, name text not null,
  radiant_workspace_id text null, settings jsonb not null default '{}',
  settings_version integer not null default 1, created_at, updated_at,
  deleted_at null)`.
- `workspace_projects(workspace_id, project_id, name, remote_url null,
  default_branch null, home_computer_id null, created_at, updated_at,
  deleted_at null; pk (workspace_id, project_id))`.
- `computer_workspace_links` (de #10) sigue; su `workspace_id` pasa a la
  expresión de ids.

`settings` (fase 1): `{ lengua, lengua_de_salida, default_permission_mode,
terminal_theme }`, todas texto o null.

Rutas nuevas (JWT, token de cliente o token de máquina; siempre de la persona):

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /v1/workspaces` | — | `{ workspaces: Workspace[] }` de quien llama |
| `POST /v1/workspaces` | `{ id, name, radiant_workspace_id?, settings?, projects?: Project[] }` | `201`; `200` si ya es suyo (idempotente, no pisa nada); `409 workspace_id_taken` |
| `PATCH /v1/workspaces/:id` | `{ name?, settings?, settings_version }` | `200` con versión +1; `409 {error:"settings_conflict", workspace}` |
| `DELETE /v1/workspaces/:id` | — | `204` (borrado suave; borra sus vínculos) |
| `PUT /v1/workspaces/:id/projects/:project` | `{ name, remote_url?, default_branch?, home_computer_id? }` | `200 Project` |
| `DELETE /v1/workspaces/:id/projects/:project` | — | `204` |
| `GET /v1/me` | — | suma `id` |

`Workspace = { id, name, radiant_workspace_id, settings, settings_version,
created_at, updated_at, projects: Project[], computers: string[] }`
(`computers` sale de `computer_workspace_links`).
`Project = { id, name, remote_url, default_branch, home_computer_id }`.

Las rutas de vínculo de #10 (`/v1/computers/self/workspaces...`) siguen; atar
con `mode: owner` crea la fila de `workspaces` si falta (con el nombre que manda
el motor) y respeta la regla de una sola dueña.

Relay — conjunto permitido `L(persona, computadora)`:

- **Dueña de la computadora:** todos los workspaces de su cuenta
  (`workspaces.owner_id`), estén o no en esta computadora. Por eso
  `materialize_workspace` y `ensure_project` pasan en una VM que aún no tiene
  el workspace.
- **Miembro:** sus workspaces atados en esta computadora.
- Toda llamada con workspace en el sobre **o en los argumentos** (`args.id` de
  las órdenes de workspace, `args.workspace`) se revisa contra `L`.
- Las órdenes de toda la máquina (cuentas de agentes, `add_workspace`,
  `materialize_workspace`, `set_project_directory`, `danil_*`,
  `remove_workspace`) son solo para la dueña de la computadora. Un miembro usa
  una lista cerrada de órdenes de su workspace.
- `/start` y `/stop` son solo de la dueña; un miembro enciende la máquina con
  una intención (mandar un mensaje).
- Tras cambiar un workspace o proyecto, el Worker avisa a los Durable Objects
  de las computadoras de la dueña: al conector
  `{ type: "workspace.changed", workspace, settings_version }` y a las sesiones
  el evento `workspace.changed`.
- `INTENT_COMMANDS` suma `materialize_workspace` y `ensure_project`.

### Motor (`seldon-host`)

Corrige de #72:

- `attention` conserva su forma de lista en un solo evento; cada entrada lleva
  su `workspace` y el relay filtra entradas (no parte el evento).
- `chat_background` contesta `null` cuando el workspace no tiene fondo propio,
  como antes.
- `set_chat_background` sin imagen conserva la imagen vigente (propia o de la
  máquina).
- `store_link` no escribe si la credencial ya no está (carrera con
  desconectar).
- Los avisos de `chat` y demás eventos de un workspace llevan su `workspace`.

Agrega:

- Atar al conectar: todo workspace local sin `danil.json` se ata a la dueña de
  la computadora (`mode: owner`).
- `add_workspace(name, folder?, git_host?, remote?, id?)`: con `id`, lo valida
  y falla con `workspace_exists` si la carpeta ya existe.
- `materialize_workspace(id)`: lee `GET /v1/workspaces`, crea aquí el workspace
  con ese id, nombre, ajustes y vínculo. Si ya existe, solo sincroniza.
- `sync_workspace(id)`: relee los ajustes de la cuenta y los escribe; corre al
  recibir `workspace.changed`.
- Setters de `lengua`, `lengua_de_salida`, `default_permission_mode`,
  `terminal_theme` y `rename_workspace` en un workspace atado publican con
  `PATCH` (ante `settings_conflict` releen y reintentan una vez; un fallo de
  red no rompe el setter local).
- Proyectos: `remote_url`, `default_branch` y `materialized: bool` en `Project`
  y `ProjectInfo`; `create_project` y `clone_project` aceptan `id?` y publican
  con `PUT`; `list_projects` de un workspace atado suma los de la cuenta que no
  están aquí (`materialized: false`).
- `ensure_project(project)`: clona con `remote_url` en
  `default_project_directory`, con el mismo id; sin remoto,
  `project_not_here`. `send_message` y `run_shell_command` de una tarea nueva lo
  llaman antes de `prepare_cwd`.

### Clientes (`terminus`)

Corrige de #185:

- El respaldo de `set_chat_background` no borra la imagen; un workspace sin
  fondo no hereda el del anterior.
- El móvil filtra eventos también por `payload.workspace`.
- `workspaceOn` no cae a «el primer workspace de la máquina»: sin pareja, error.
- Pruebas del filtro dentro del transporte.

Agrega:

- Con varias máquinas, los ids de workspace y de proyecto **no** llevan
  prefijo; solo tareas, portafolios y cuentas de agentes.
- Los workspaces se agrupan por id igual, nunca por nombre ni remoto.
- Los proyectos de todas las máquinas se juntan por id; la fila dice en qué
  máquinas está (`machines`).
- Al crear: la máquina elegida, si no la última usada, si no la de la ventana.
  Si esa máquina no tiene el workspace, primero `materialize_workspace` en
  ella. Un proyecto sin remoto que vive en otra máquina deja esa opción
  desactivada en «Ejecutar en», con la razón.
- «Usar este workspace aquí» se borra.
- El campo `linked` de `features/machines/store.ts` se renombra a `hosts`
  (tiene el workspace), para no confundirlo con el vínculo de la cuenta.

### Fase 2 (fuera de esta entrega)

Logo, fondo, MCP y skills desde la cuenta; adoptar las copias viejas de «Usar
este workspace aquí»; workspaces de organización con varias personas; que un
miembro materialice workspaces en una computadora compartida.
