/**
 * Lo que este front puede hacer donde corre. El escritorio lo puede todo y es
 * el valor por defecto; la entrada web (`src/web/main.tsx`) lo fija antes de
 * importar la app y no cambia después.
 */
import type { JSX } from "solid-js";
import type { AccountProfileSource } from "../features/settings/account-profile";
import type { Account } from "../features/settings/accounts-store";

/** Una cuenta agrupada en la web: las máquinas donde tiene sesión (`web/fleet.ts`). */
export type AccountMachinesProps = {
  account: Account;
  provider: string;
  /** Agrega y conecta una cuenta en otra máquina con el flujo de siempre. */
  add: (options: { headers: Record<string, string> }) => Promise<void>;
  refresh: () => void;
};

export type Capabilities = {
  /** Controles de ventana propios, semáforo de macOS y bandeja. */
  nativeWindow: boolean;
  /** El actualizador firmado de la app. */
  updater: boolean;
  /** La preparación del entorno con su instalador a la vista, y el paso del alta que instala asistentes. */
  localSetup: boolean;
  /** Una computadora apagada o encendiéndose se ve en su indicador, no como error. */
  computerStatus: boolean;
  /** Radiant en Configuración y su gobierno en las pantallas; la web no lo ofrece. */
  radiant?: boolean;
  /** Iniciar sesión en Danil desde Configuración: la web ya entra con esa cuenta. */
  danilAccount?: boolean;
  /** La persona de la cuenta de Danil leída sin el motor (la web, con su sesión): pie y Configuración. */
  accountProfile?: AccountProfileSource;
  /** Botón extra al lado de la búsqueda de la barra lateral (en la web, volver a Danil Agents). */
  sidebarExtra?: () => JSX.Element;
  /** El nombre de una máquina por su id. */
  machineName?: (id: string) => string;
  /** La máquina de la cuenta que guarda una tarea o un space por su id de panel (`<máquina>~<id>`); `null` si es de la ventana. */
  taskMachine?: (id: string) => string | null;
  /** La que corre las tareas que llegan sin `machine`; sin esto, la de la ventana. */
  windowMachine?: () => { id: string; name: string; local: boolean } | undefined;
  /** Dónde se crea un proyecto nuevo, en el diálogo de añadirlo. */
  machineOnCreate?: (workspace: string | null) => JSX.Element;
  /** La máquina donde se crea ahora un proyecto nuevo, si no es la de la ventana; `lead`, si sus spaces son los del panel. */
  remoteCreate?: (workspace: string | null) => { machine: string; lead: boolean } | null;
  /** Los adjuntos salen del navegador como bytes: el motor solo guarda imágenes (`guardar_imagen_pegada`). */
  browserFiles?: boolean;
  /** El visor de la pantalla de una VM administrada (solo ver); `null` si esa máquina no tiene. */
  machineScreen?: (machine: string) => (() => Promise<WebSocket>) | null;
  /** El estado de la rebanada de cada otra máquina (`@terminus/fleet`): `ok`, `cached`, `no_answer`, `off` u `outdated`, con su hora. */
  machineSlices?: () => Record<string, { status: "ok" | "cached" | "no_answer" | "off" | "outdated" | "license_required"; at: number | null }>;
  /** `license_required` si el relay detuvo las otras máquinas por falta de Terminus de pago (aviso `TerminusLicense`); `null` si no. */
  machinesLicense?: () => "license_required" | null;
  /** «Reintentar» del aviso de licencia: vuelve a abrir las sesiones de las otras máquinas. */
  retryMachines?: () => void;
  /** Bajo la tarjeta de una cuenta: sus máquinas. */
  accountMachines?: (props: AccountMachinesProps) => JSX.Element;
};

const DESKTOP: Capabilities = { nativeWindow: true, updater: true, localSetup: true, computerStatus: false, danilAccount: true, radiant: true };

let current = DESKTOP;

export const capabilities = (): Capabilities => current;

export function setCapabilities(next: Capabilities) {
  current = next;
}
