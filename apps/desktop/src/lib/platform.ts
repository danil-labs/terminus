/**
 * Lo que este front puede hacer donde corre. El escritorio lo puede todo y es
 * el valor por defecto; la entrada web (`src/web/main.tsx`) lo fija antes de
 * importar la app y no cambia después.
 */
import type { Answer, Computer, CredentialSource, MemorySource, SpaceOrderSource } from "@terminus/computers";
import type { JSX } from "solid-js";
import type { AccountProfileSource } from "../features/settings/account-profile";
import type { Account } from "../features/settings/accounts-store";
import type { WorkspaceAssetsSource } from "../web/workspace-assets";

/** Una cuenta agrupada en la web: las máquinas donde tiene sesión (`@terminus/fleet`, `merge.ts`). */
export type AccountMachinesProps = {
  account: Account;
  provider: string;
  /** Agrega y conecta una cuenta en otra máquina con el flujo de siempre. */
  add: (options: { headers: Record<string, string> }) => Promise<void>;
  refresh: () => void;
};

/** Las computadoras de la cuenta en Configuración: leerlas, renombrarlas y avisar del nombre nuevo. */
export type AccountComputersSource = {
  list: () => Promise<Answer<Computer[]>>;
  rename: (id: string, name: string) => Promise<Answer<{ computer_id: string; name: string }>>;
  /** Si su motor no habla el contrato de esta ventana. */
  outdated?: (computer: Computer) => boolean;
  /** Quien pinta nombres de máquina (la flota) toma el nuevo sin recargar. */
  onRenamed: (id: string, name: string) => void;
};

/** Un workspace de otra cuenta de Danil de este navegador: se ve en la columna y abrirlo recarga con su cuenta. */
export type OtherWorkspace = { id: string; name: string; logo: () => Promise<string | null> };

/** Otra cuenta de Danil de este navegador (`web/accounts.ts`). `signedIn: false`: su sesión caducó; `stale`: su lista es la guardada. */
export type OtherAccount = { user_id: string; email: string | null; name: string | null; extra: boolean; signedIn: boolean; stale: boolean; workspaces: OtherWorkspace[] };

/** Las cuentas de Danil de la web: la abierta y las demás con sus workspaces (`docs/web-multi-account.md`). */
export type WebAccountsSource = {
  current: { user_id: string; email: string | null; name: string | null; extra: boolean };
  /** Reactivo: cambia al volver a leer los registros. */
  others: () => OtherAccount[];
  /** Abre un workspace de otra cuenta: la página se recarga con esa cuenta. */
  open: (workspace: string) => void;
  /** «Agregar cuenta»; `email`, para volver a entrar con una que caducó. */
  add: (email?: string | null) => void;
  /** Olvida una cuenta extra en este navegador. */
  remove: (userId: string) => Promise<void>;
};

export type Capabilities = {
  inbox?: { initial: boolean; render: () => JSX.Element; agentSettings: (name: string) => JSX.Element; integrations: () => JSX.Element };
  spaceOrder?: SpaceOrderSource;
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
  /** El logo y el fondo de los workspaces leídos y cambiados en la cuenta con la sesión (la web). */
  accountAssets?: WorkspaceAssetsSource;
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
  /** `license_required` si el relay detuvo las otras máquinas por falta de Terminus de pago (aviso `TerminusLicense`); `null` si no. */
  machinesLicense?: () => "license_required" | null;
  /** «Reintentar» del aviso de licencia: vuelve a abrir las sesiones de las otras máquinas. */
  retryMachines?: () => void;
  /**
   * La memoria versionada de los workspaces en la cuenta (`/v1/workspaces/:id/memory/*`)
   * con la sesión de la persona: en la web, la pestaña Memoria la lee y la escribe
   * ahí, aunque todas las máquinas estén apagadas. La ventana usa el token de
   * cliente de la cuenta de cada workspace (`memory-account.ts`).
   */
  accountMemory?: MemorySource;
  /**
   * Las credenciales de la cuenta (`/v1/workspaces/:id/credentials`) con la sesión
   * de la persona: la web las lee, las quita por máquina y las sella en el
   * navegador. La ventana pasa por los comandos del motor (`account_credentials_*`).
   */
  accountCredentials?: CredentialSource;
  /** Bajo la tarjeta de una cuenta: sus máquinas. */
  accountMachines?: (props: AccountMachinesProps) => JSX.Element;
  /**
   * «Conectar otra máquina» con la sesión de la página (la web): la lista de la
   * cuenta y qué hacer cuando la nueva está en línea. El escritorio usa su token
   * de cliente (`features/machines/ConnectMachine.tsx`).
   */
  /** Las computadoras de la cuenta con la sesión de la página (la web); el escritorio usa su token de cliente. */
  accountComputers?: AccountComputersSource;
  /** Varias cuentas de Danil en una ventana (la web); el escritorio no la da. */
  webAccounts?: WebAccountsSource;
  connectMachine?: {
    list: () => Promise<Answer<Computer[]>>;
    outdated?: (computer: Computer) => boolean;
    onReady: (computer: Computer) => void;
  };
};

const DESKTOP: Capabilities = { nativeWindow: true, updater: true, localSetup: true, computerStatus: false, danilAccount: true, radiant: true };

let current = DESKTOP;

export const capabilities = (): Capabilities => current;

export function setCapabilities(next: Capabilities) {
  current = next;
}
