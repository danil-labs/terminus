# Terminus móvil

Una app de iOS y Android para ver y dirigir Terminus desde el teléfono: qué
tareas te necesitan, aprobar o rechazar permisos, contestar preguntas, escribirle
a una tarea o a un agente y crear tareas nuevas. No es un editor ni una terminal.

Trabaja sobre las máquinas de la persona a través de **Danil Computers**: por
omisión su VM administrada por Danil, y además cualquier otra máquina donde
Terminus o su Seldon Host esté conectado a su cuenta (una Mac, otro VPS). Cada
máquina sigue siendo la dueña de sus tareas; el teléfono es otro cliente más,
como la web.

## Decisiones

- **Expo (React Native, TypeScript)**, con módulos nativos de Swift o Kotlin
  solo cuando Expo no alcance. Es el mismo camino que tomó Orca
  (`stablyai/orca`, MIT): una base de código para las dos plataformas,
  notificaciones push reales y actualizaciones OTA.
- **Cuenta de Danil.** Se entra como en app.danil.ai: correo y contraseña, o
  Google y Microsoft por el navegador del sistema con PKCE
  (`expo-web-browser`). Lo único que se guarda es la sesión de Supabase, en el
  llavero (`expo-secure-store`, en trozos porque pasa de 2 KB). Hermes no trae
  WebCrypto: `apps/mobile/src/lib/supabase.ts` lo completa con `expo-crypto` para que PKCE
  use S256 y no `plain`.
- **Las reglas de la web valen igual** (`@terminus/computers`): abrir la app
  nunca enciende una máquina; cada máquina se ve solo encendida, apagada o
  encendiéndose, nunca como error; escribir, crear una tarea, aprobar o
  contestar despiertan una VM administrada por el relay; una máquina propia
  apagada no se puede despertar y se dice en tono neutro. Qué se puede
  encender lo decide `wakes()`, la misma regla que la web (#154): manda
  `wakeable` si el plano de control lo da, luego `kind` (`physical`, `vps`…),
  luego el proveedor (`aws-ec2`, o ninguno en filas viejas). Un motor que no
  habla el contrato (`outdated`) no recibe acciones. Con la VM apagada las
  lecturas vienen de la copia del relay (`cached: {updated_at}`) y la app dice
  de qué hora es; sin copia, `machine_off` es una lista vacía.
- **Lista cerrada de comandos en los dos caminos** (`APP_COMMANDS` en
  `packages/protocol`): son funciones de ventana con el contrato renombrado.
  El relay de Danil Computers solo bloquea las funciones de escritorio, así que
  la lista la hace cumplir el cliente (`apps/mobile/src/lib/hosts.ts`, `command_not_allowed`);
  el bridge de desarrollo contesta 403 con la misma lista.
- **La lista de tareas es la del sidebar del escritorio (#151)**, adaptada al
  teléfono y derivada del mismo código (`@terminus/tasks`): lista plana de todas
  las carpetas y todas las máquinas, un solo filtro, tarjeta de dos líneas y
  dock de agentes (ver «Patrones del teléfono»). Las palabras salen de las
  mismas claves que los catálogos del escritorio (`WORDS` en
  `@terminus/design`, vigiladas por el guard `shared-design`).
- **Barra de pestañas del sistema** (`expo-router/native-tabs`): Liquid Glass en
  iOS 26 y Material 3 en Android. Tiene Tareas y Notificaciones, más "Nueva"
  aparte con `role="search"`, como en t3code. No se dibuja una barra propia.
- **Tema claro y oscuro** según el sistema, con los tokens por omisión del
  escritorio en `apps/desktop/src/styles/global.css`: Violeta en claro y Grafito en oscuro.
- **El teléfono no ve la pantalla de la máquina.** Habla los comandos de la
  ventana a través del relay (o del bridge en desarrollo).

## Patrones del teléfono

| Escritorio (#151) | Teléfono | Por qué |
|---|---|---|
| Lista plana con secciones «Te necesitan» y «Tareas» | Igual, en una sola columna; «Te necesitan» solo aparece si tiene algo | En una pantalla chica una sección vacía empuja la lista sin decir nada |
| Botón «Filtrar y agrupar» con popover (carpetas, agente, agrupar, densidad) | El mismo botón al lado de la línea de alcance; abre una hoja del sistema (`formSheet`) con las mismas opciones y palabras | Un popover no cabe ni se toca bien con el dedo; la hoja es el popover del teléfono y se cierra con el gesto |
| Tarjeta de dos líneas: estado + título + chincheta; debajo, lo que pide o carpeta, agente, máquina y PR | Igual, sacado de `taskCard`; sin PR ni worktree (el teléfono no lee git); la máquina solo con más de una | Misma información en el mismo orden; lo que el teléfono no puede saber no se inventa |
| Dock de agentes: una fila de caras al pie del sidebar; clic abre el chat, clic derecho «Ver sus tareas» | Una fila de caras **arriba de la lista**, del mismo orden y reparto (`planDock`, «+k»); tocar abre su chat, mantener pulsado filtra por sus tareas; «Ver todos» abre una hoja | Abajo choca con la barra de pestañas y «Nueva»; arriba se ve al entrar y se va al hacer scroll, sin robar alto a la lista. Mantener pulsado es el clic derecho del teléfono |
| SpaceBar | Las píldoras de space bajo el workspace, como antes | El escritorio la conserva; es el alcance de la lista |

## Cómo está armado

```
                                  ┌─▶ VM de Danil (conector)
[App Expo] ──WSS + JWT──▶ [relay de Danil Computers] ─┤
     │                                               └─▶ Mac / VPS con Seldon Host
     └──HTTP + token (desarrollo)──▶ [bridge] ──RPC1──▶ [motor del lab]
```

- `apps/mobile/src/lib/account.tsx` y `supabase.ts`: la sesión de la cuenta de Danil.
- `apps/mobile/src/lib/machines.tsx`: `GET /v1/computers` y una sesión de relay por máquina
  (`relayHost`), más el bridge si está emparejado (`bridgeHost`); la atención
  de cada una y los avisos.
- `apps/mobile/src/lib/hosts.ts` y `engine.ts` (sin React Native): una máquina, la lista
  cerrada y lo que el teléfono hace con su motor. Las tareas de un workspace
  salen de `list_live_sessions` por carpeta y para `""`, como la ventana; una
  tarea nueva es `send_message` sin sesión; la conversación, `load_session`;
  aprobaciones y preguntas, `pending_requests` y el turno de la pregunta.
- `apps/mobile/src/lib/workspaces.tsx`: el reparto entre máquinas, con la regla de la web
  (`groupWorkspaces`): cada motor tiene sus ids, así que dos workspaces son el
  mismo si tienen el mismo proveedor y remoto o, si no, el mismo nombre. Se ven
  una vez; sus carpetas y tareas vienen de cada máquina, marcadas con ella
  (`host/id`), y cada acción va a la máquina de la tarea con el id que ella le
  da al workspace. Los spaces son los de la primera máquina (la VM administrada).

Los avisos salen en la app, igual para los dos caminos: una tarea que entra en
`approving`, `asked` o `failed` (evento `attention`) o un turno que termina bien
(`chat` con `done`; el motor marca `unseen` en cuanto arranca el turno).

| Ruta | Qué es |
|---|---|
| `signin` | Entrar con la cuenta de Danil; en desarrollo, el enlace al bridge |
| `(tabs)/index` | Tareas: workspace, spaces, alcance y filtro, dock de agentes y la lista plana |
| `(tabs)/notifications` | «Ahora» de todas las máquinas y «Antes», lo que llegó con la app abierta |
| `(tabs)/new` | Nueva tarea: máquina (la última usada, si no la VM), carpeta, agente opcional y encargo |
| `filter` | Hoja «Filtrar y agrupar» |
| `agents` | Hoja «Ver todos» del dock |
| `workspaces` | Hoja con los workspaces, las máquinas y su estado, la cuenta y la conexión de desarrollo |
| `agent/[workspace]/[name]` | Conversaciones con el agente y cuadro para empezar otra |
| `task/[host]/[workspace]/[folder]/[id]` | Conversación en la máquina de la tarea: aprobaciones, preguntas, enviar y detener |
| `pair` | Bridge de desarrollo; también `terminus-mobile://pair?url=…&token=…` |
| `auth/callback` | La vuelta del navegador del inicio con Google o Microsoft |

Las tareas nuevas usan el proveedor y el modelo de la tarea más reciente de esa
máquina (o del agente); si no hay ninguna, el primer proveedor disponible.

## Probarla

Sin la sesión de nadie, contra el Danil Computers falso (`apps/mobile/scripts/fake-computers.mjs`:
login de Supabase, `/v1/computers`, `/start` y el relay con espejo, con una VM
apagada y una Mac propia que comparten un workspace, cada motor con sus ids):

```bash
cd apps/mobile
npm run computers:smoke            # la capa de datos en Node, sin simulador
npm run computers:fake             # o el falso en :8787 para la app
EXPO_PUBLIC_SUPABASE_URL=http://<ip>:8787 EXPO_PUBLIC_COMPUTERS_ENDPOINT=http://<ip>:8787 npm start
```

En la app se entra con cualquier correo y contraseña. `--mac-off` apaga la Mac;
`--license` simula una cuenta sin Terminus.

El camino de desarrollo con el motor del lab sigue igual:

```bash
pnpm engine:download && node apps/desktop/scripts/engine.mjs engine   # motor del lab
node apps/mobile/bridge/bridge.mjs                                      # imprime dirección y token
```

## Qué está comprobado (2026-10-19, macOS, sin simulador)

Esta Mac no tiene runtimes de iOS (`xcrun simctl list runtimes` vacío), así que
no se abrió la app. Se comprobó:

- `npm run typecheck`, `npm run doctor` (20/20) y `npx expo export --platform ios`
  (el bundle de Hermes se arma, con los paquetes compartidos).
- `npm run computers:smoke`, contra el falso por HTTP y WebSocket reales: la
  lista de máquinas; un comando fuera de la lista no se envía; el reparto de un
  workspace entre la VM y la Mac con cada tarea etiquetada; la VM apagada leída
  de la copia sin encenderse; Nueva tarea en la VM apagada la enciende, el
  turno corre y llega el aviso de terminada; en la Mac, un permiso aprobado
  desde el teléfono y sus avisos; una Mac apagada no recibe la acción.
- Las pruebas de `packages/computers` y `packages/tasks`, y la cadena del
  escritorio sin Rust (`verify.mjs --no-cargo`), con el guard `shared-design`.

**No está comprobado:**

- Ninguna pantalla: ni el inicio de sesión, ni tocar botones, ni el dock, la
  hoja del filtro o las tarjetas en un simulador o un teléfono.
- Google y Microsoft de verdad: necesitan la URL de vuelta en Supabase (abajo).
- Contra `computers.danil.ai` y una VM real, y contra el bridge con el motor
  del lab después del cambio a `service invoke`.
- Preguntas (`answer_question`) de punta a punta.
- Android, avisos con la app cerrada, deep links en frío en Expo Go.

## Lo que necesita el plano de control

1. **URLs de vuelta en Supabase** (Auth → URL Configuration → Redirect URLs):
   `terminus-mobile://auth/callback` para los builds y, en desarrollo con Expo
   Go, `exp://**`. Sin eso Google y Microsoft no vuelven a la app; correo y
   contraseña funcionan igual.
2. **Decir qué máquina se puede encender.** `GET /v1/computers` hoy da
   `provider`; la web y la app ya leen `wakeable` y `kind` si llegan. Sin
   ellos, una máquina propia registrada sin proveedor se tomaría por VM. Con
   `kind: "physical"` (o `wakeable: false`) la app no le manda intenciones; sin
   eso, el relay la intentaría encender y volvería `start_failed`.
3. **Lista de permiso por cliente en el relay.** El relay solo bloquea funciones
   de escritorio; la lista cerrada del teléfono la hace cumplir el cliente. Si
   se quiere que el servidor también la imponga, el relay necesita saber que la
   sesión es del teléfono (otro subprotocolo, p. ej. `danil.computers.v1.mobile`).

## Lo que sigue

1. **Development build con EAS**, para push remotas, el ícono y el esquema
   `terminus-mobile://` (también para la vuelta de Google y Microsoft).
2. **Gateway de push.** Un servicio que guarda la llave de APNs y la cuenta de
   FCM; las máquinas le piden enviar. Los avisos ya se calculan en la app.
3. **La web al paquete compartido.** `apps/desktop/src/web/relay.ts`,
   `computers.ts` y las reglas de `fleet.ts` (`wakes`, el orden y el grupo de
   workspaces) están en `@terminus/computers`; la web debería importarlo en
   vez de su copia.
