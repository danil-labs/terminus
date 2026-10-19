# Terminus móvil

Una app de iOS y Android para ver y dirigir Terminus desde el teléfono: qué
tareas te necesitan, aprobar o rechazar permisos, contestar preguntas, escribirle
a una tarea o a un agente y crear tareas nuevas. No es un editor ni una terminal.
El host (Terminus de escritorio hoy, Seldon Host en una VM mañana) sigue siendo
el dueño de todo; el teléfono es otro cliente más.

## Decisiones

- **Expo (React Native, TypeScript)**, con módulos nativos de Swift o Kotlin
  solo cuando Expo no alcance. Es el mismo camino que tomó Orca
  (`stablyai/orca`, MIT): una base de código para las dos plataformas,
  notificaciones push reales y actualizaciones OTA.
- **La navegación es el sidebar del escritorio.** Arriba, el workspace (abre
  la hoja con todos los workspaces y la conexión) y las píldoras de space, que
  filtran como `SpaceBar`. Debajo, cada carpeta del space con sus agentes y sus
  tareas. Un agente abre su conversación directa.
- **Barra de pestañas del sistema** (`expo-router/native-tabs`): Liquid Glass en
  iOS 26 y Material 3 en Android. Tiene Tareas y Notificaciones, más "Nueva"
  aparte con `role="search"`, como en t3code. No se dibuja una barra propia.
- **Las marcas de tarea son las del sidebar.** `packages/design` tiene la
  prioridad, los íconos, los colores y las frases que usan la ventana y la app,
  y el guard `shared-design` falla si se apartan del escritorio: la misma
  prioridad (aprobando, preguntó, trabajando, falló, sin ver), los mismos
  íconos de Lucide, los mismos colores por tema y los mismos textos. Un space,
  un agente o un workspace muestran la marca más urgente de sus tareas, como
  una fila plegada. Si cambian en el escritorio, se cambia el paquete.
- **Tema claro y oscuro** según el sistema, con los tokens por omisión del
  escritorio en `apps/desktop/src/styles/global.css`: Violeta en claro y Grafito en oscuro
  (`[data-dark-style="graphite"]`), no el navy.
- **El teléfono no ve la pantalla de la máquina.** Habla el mismo contrato que
  la CLI de Terminus a través de un bridge.

## Cómo está armado

```
[App Expo] ──HTTP + token──▶ [bridge] ──RPC1 (loopback)──▶ [motor seldon-runtime]
```

`apps/mobile/bridge/bridge.mjs` es un programa de Node sin dependencias que corre en
la máquina del motor:

- Habla RPC1 con el motor por loopback, como la ventana, leyendo
  `seldon-endpoint.json` y su token.
- Sirve al teléfono `GET /v1/status`, `POST /v1/call` y `GET /v1/events`
  (long-poll). Pide `Authorization: Bearer <token>`; el token se genera una vez
  y se guarda en `apps/desktop/.engine/mobile-bridge.json` con permisos `0600`.
- Solo deja pasar una lista cerrada de comandos: los de la CLI (`workspace list`,
  `folder list`, `space list`, `handler list`, `task list|show|read|create|send|stop`,
  `agent list|models`, `operation show`) y los que contesta una persona
  (`respond_permission`, `answer_question`, `mark_task_seen`,
  `list_workspace_attention`, `list_active_turns`). `task permission` no sirve porque solo lo acepta
  el lanzador de la tarea.
- Sin `--allow-lan` solo contesta a loopback y a Tailscale (100.64.0.0/10). El
  HTTP va cifrado dentro del tailnet; en una LAN no.
- Convierte los eventos del motor en avisos: una tarea que pasa a `approving`,
  `asked` o `failed` (de `attention`), o un turno que termina bien (`chat` con
  `done`). El motor marca `unseen` en cuanto arranca el turno, así que "terminó"
  sale de `done` y no de `attention`.

La app (`apps/mobile/src`) usa expo-router:

| Ruta | Qué es |
|---|---|
| `(tabs)/index` | Tareas: workspace, píldoras de space y, por carpeta, sus agentes y sus tareas con su marca |
| `(tabs)/notifications` | "Ahora": lo que el motor reporta en `attention` de todos los workspaces; "Antes": lo que llegó con la app abierta y ya no espera |
| `(tabs)/new` | Nueva tarea: carpeta del space, agente opcional y encargo (`task create`, con `--handler` si hay agente) |
| `workspaces` | Hoja con los workspaces y sus marcas, la conexión y Desconectar |
| `agent/[workspace]/[name]` | Conversaciones con el handler y cuadro para escribirle |
| `task/[workspace]/[folder]/[id]` | Conversación en vivo, aprobaciones, preguntas, enviar y detener |
| `pair` | Dirección y token del bridge; también abre con `terminus-mobile://pair?url=…&token=…` |

Las tareas nuevas usan el agente y el modelo de la tarea más reciente del
workspace, o del handler. Si no hay ninguna, la app pide crear la primera desde
Terminus.

## Probarla

```bash
pnpm engine:download && node apps/desktop/scripts/engine.mjs engine   # motor del lab
node apps/mobile/bridge/bridge.mjs                                      # imprime dirección y token
cd apps/mobile && npm install && npm start                              # Metro
```

El lab queda atado a la ruta absoluta de sus datos: si el checkout cambia de
lugar, el motor sale con `cli.error.authority_incompatible`. Es desechable: se
borra `apps/desktop/.engine/lab` y se arranca de nuevo.

En el teléfono abre Expo Go, escanea el QR de Metro y pega la dirección de
Tailscale (`http://100.x.y.z:6780`) y el token que imprimió el bridge.

## Qué está comprobado (2026-10-17, macOS, simulador iPhone 17 con iOS 26.5, Expo Go 58)

Contra el motor del lab 0.2.73, con `opencode-zen` y un modelo gratuito:

- El bridge rechaza un token incorrecto (401) y un comando fuera de la lista
  (403). El long-poll entrega `delta`, `done`, `permission` y `attention` de un
  turno real, y los avisos `approving` y `finished`.
- En el simulador, con español como idioma: emparejar por deep link, conservar
  el emparejamiento tras cerrar la app y abrirla, la barra nativa con "Nueva"
  aparte, Tareas por carpeta con su agente, Nueva tarea, Notificaciones, la hoja
  de workspaces con dos workspaces, el agente y la conversación con la tarjeta
  de aprobación fija encima del cuadro de texto.
- Las marcas del sidebar (trabajando, pide aprobación, terminó sin ver,
  plegada en spaces y agentes) en tema claro (Violeta) y oscuro (Grafito).
- Al aprobar un permiso con la misma llamada que hace el botón
  (`respond_permission` por el bridge), la tarjeta se va y la respuesta llega en
  vivo a la conversación abierta.

**No está comprobado:**

- Tocar botones. Esta Mac no tiene la app Simulator, así que no se pulsó
  Aprobar, Enviar, crear tarea ni cambiar de workspace con el dedo.
- Las preguntas (`answer_question`): ningún turno del lab llegó a preguntar.
- Android y un teléfono real.
- Los avisos con la app cerrada. Hoy los avisos son notificaciones locales, que
  solo salen mientras la app está viva; las push necesitan lo que sigue.
- En Expo Go, un deep link en frío abre el Inicio en vez de la ruta pedida.

## Lo que sigue

1. **Development build con EAS**, para tener push remotas (Expo Go ya no las
   permite en Android), el ícono y el nombre propios y el esquema
   `terminus-mobile://`.
2. **Gateway de push.** Igual que Orca: un servicio en la nube es el único que
   guarda la llave de APNs y la cuenta de FCM; el host se autentica con su llave,
   registra el token de cada teléfono y le pide enviar. El bridge ya calcula los
   avisos; solo cambia el canal de entrega.
3. **Relay en la nube** para no depender de Tailscale: el host y el teléfono
   abren conexiones salientes y el relay las une. Así un Seldon Host en una VM
   se conecta igual que la Mac.
4. **Llevar el bridge al host.** Hoy es un programa aparte para desarrollo; su
   lugar es Seldon Host (ver `seldon-host/docs/host-separation-plan.md`), con
   emparejamiento por QR y llaves por dispositivo en vez de un token compartido.
