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
  /** Iniciar sesión en Danil desde Configuración: la web ya entra con esa cuenta. */
  danilAccount?: boolean;
  /** La persona de la cuenta de Danil leída sin el motor (la web, con su sesión): pie y Configuración. */
  accountProfile?: AccountProfileSource;
  /** Botón extra al lado de la búsqueda de la barra lateral (en la web, volver a Danil Agents). */
  sidebarExtra?: () => JSX.Element;
  /** El nombre de una máquina por su id. */
  machineName?: (id: string) => string;
  /** Dónde se crea un proyecto nuevo, en el diálogo de añadirlo. */
  machineOnCreate?: (workspace: string | null) => JSX.Element;
  /** «Usar este workspace aquí» en una máquina que no lo tiene (`features/machines/workspace-here.ts`). */
  workspaceOnMachine?: boolean;
  /** Bajo la tarjeta de una cuenta: sus máquinas. */
  accountMachines?: (props: AccountMachinesProps) => JSX.Element;
};

const DESKTOP: Capabilities = { nativeWindow: true, updater: true, localSetup: true, computerStatus: false, danilAccount: true };

let current = DESKTOP;

export const capabilities = (): Capabilities => current;

export function setCapabilities(next: Capabilities) {
  current = next;
}
