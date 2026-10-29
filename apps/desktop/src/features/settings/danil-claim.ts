/**
 * Iniciar sesión desde un workspace sin cuenta lo deja en la cuenta que entra,
 * y a ningún otro. Fuera de los componentes: la entrada se aprueba en el
 * navegador, y Configuración puede cerrarse mientras tanto.
 */
import { listen } from "../../lib/serviceEvents";
import {
  connectedSessions,
  type DanilSessionInfo,
  newSessionKey,
  readSessions,
  sessionKey,
  setWorkspaceAccount,
} from "./danil-sessions";

/** Lo que dura el código de entrada: después ya no se espera a nadie. */
const WAIT_MS = 15 * 60_000;

let stopCurrent: (() => void) | null = null;

/** `sessions`: las que ya había, que no cuentan como la que entra. */
export function claimNextSession(workspace: string, sessions: DanilSessionInfo[] | null | undefined) {
  stopCurrent?.();
  const known = connectedSessions(sessions)
    .map(sessionKey)
    .filter((k): k is string => Boolean(k));
  let done = false;
  const offs = [
    listen<DanilSessionInfo[]>("danil-sessions", (e) => void check(Array.isArray(e.payload) ? e.payload : null)),
    listen("danil-connect", () => void readSessions().then(check).catch(() => {})),
  ];
  const timer = setTimeout(() => stop(), WAIT_MS);
  function stop() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const off of offs) void off.then((f) => f());
    if (stopCurrent === stop) stopCurrent = null;
  }
  async function check(list: DanilSessionInfo[] | null) {
    if (done) return;
    const key = newSessionKey(known, list);
    if (!key) return;
    stop();
    // Si falla, el workspace sigue diciendo «sin cuenta» y su selector deja elegirla.
    await setWorkspaceAccount(workspace, key).catch(() => {});
  }
  stopCurrent = stop;
  return stop;
}
