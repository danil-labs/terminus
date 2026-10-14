import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Button } from "../../ui/Button";
import { Toast } from "../../ui/Toast";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { stopTurns } from "./CloseGuard";

/** El reinicio requiere una acción de la persona; descartar dura hasta otra versión. */
const CADA = 30 * 60 * 1000;
const AL_VOLVER = 10 * 60 * 1000;
/** Mirar si otra versión quedó instalada es local: no espera a la red. */
const INSTALADA_CADA = 60 * 1000;

export default function AvisoDeVersion() {
  const [fallo, setFallo] = createSignal(false);
  const [hay, setHay] = createSignal<Update | null>(null);
  const [alDia, setAlDia] = createSignal(false);
  const [estado, setEstado] = createSignal<"quieto" | "bajando" | "listo">("quieto");
  /** Otra versión quedó instalada sobre esta ventana: desde aquí o con el instalador a mano. */
  const [instalada, setInstalada] = createSignal(false);
  const [instaladaVista, setInstaladaVista] = createSignal(false);
  /** Versiones que esta persona ya descartó. */
  const [descartadas, setDescartadas] = createSignal<string[]>([]);

  let pendiente: Promise<void> | null = null;
  let ultima = 0;

  function mirar(): Promise<void> {
    if (pendiente) return pendiente;
    if (estado() !== "quieto") return Promise.resolve();
    ultima = Date.now();
    pendiente = comprobar().finally(() => {
      pendiente = null;
    });
    return pendiente;
  }

  async function comprobar() {
    try {
      const u = await check();
      if (estado() !== "quieto") return;
      // Descartada: no se vuelve a asomar por la misma versión.
      if (u && !descartadas().includes(u.version)) {
        setAlDia(false);
        setHay(u);
      }
    } catch {
      // Sin red no se sabe si hay versión nueva, y eso no es un fallo de la app:
      // no se pinta nada y se sigue trabajando.
    }
  }

  function mirarInstalada() {
    void invoke<boolean>("update_pending")
      .then((si) => si && setInstalada(true))
      .catch(() => {});
  }

  onMount(() => {
    void mirar();
    mirarInstalada();
    const reloj = setInterval(() => void mirar(), CADA);
    const relojLocal = setInterval(mirarInstalada, INSTALADA_CADA);
    const volver = () => {
      mirarInstalada();
      if (document.visibilityState === "visible" && Date.now() - ultima > AL_VOLVER) void mirar();
    };
    window.addEventListener("focus", volver);
    document.addEventListener("visibilitychange", volver);
    onCleanup(() => {
      clearInterval(reloj);
      clearInterval(relojLocal);
      window.removeEventListener("focus", volver);
      document.removeEventListener("visibilitychange", volver);
    });
  });

  async function poner() {
    const u = hay();
    if (!u || estado() !== "quieto") return;
    setFallo(false);
    setEstado("bajando");
    try {
      await pendiente;
      ultima = Date.now();
      const reciente = await check();
      if (!reciente) {
        setHay(null);
        setAlDia(true);
        setEstado("quieto");
        return;
      }
      setHay(reciente);
      // En Windows `downloadAndInstall` cierra la app; Rust instala sin cerrarla.
      await invoke("update_install");
      setEstado("listo");
    } catch {
      // Si falla la descarga, el aviso se queda: volver a intentarlo es del
      // botón, no de un reintento automático que nadie ve.
      setFallo(true);
      setEstado("quieto");
    }
  }

  return (
    <>
      <Show when={alDia()}>
        <Toast>
          <p class="m-0 text-xs text-neutral-500">{t("settings.update.uptodate")}</p>
          <Button variant="ghost" size="sm" onClick={() => setAlDia(false)}>{t("shell.update.later")}</Button>
        </Toast>
      </Show>
      <Show when={instalada() && !instaladaVista() && !hay()}>
        <Toast>
          <p class="m-0 text-xs text-neutral-500">{t("shell.update.installed")}</p>
          <div class="flex gap-1.5">
            <Aplicar />
            <Button variant="ghost" size="sm" onClick={() => setInstaladaVista(true)}>
              {t("shell.update.later")}
            </Button>
          </div>
        </Toast>
      </Show>
      <Show when={hay()}>
        {(u) => (
          <Toast>
            <p class="m-0 text-[0.8125rem] font-semibold">
              {t("shell.update.available", { version: u().version })}
            </p>

            <Show when={fallo()}>
              <p class="m-0 text-xs text-warning-strong">
                {t("settings.update.error_download")}
              </p>
            </Show>

            <Show when={estado() === "quieto"}>
              <p class="m-0 text-xs text-neutral-500">
                {t("shell.update.background")}
              </p>
              <div class="flex gap-1.5">
                <Button variant="primary" size="sm" onClick={() => void poner()}>
                  {t("shell.update.install")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDescartadas((d) => [...d, u().version]);
                    setHay(null);
                  }}
                >
                  {t("shell.update.later")}
                </Button>
              </div>
            </Show>

            <Show when={estado() === "bajando"}>
              <p class="m-0 text-xs text-neutral-500">{t("shell.update.downloading")}</p>
            </Show>

            <Show when={estado() === "listo"}>
              <p class="m-0 text-xs text-neutral-500">
                {t("shell.update.ready")}
              </p>
              <div class="flex gap-1.5">
                <Aplicar />
              </div>
            </Show>
          </Toast>
        )}
      </Show>
    </>
  );
}

type LiveTurn = { session: string; workspace: string; project: string; started_at: number; shell?: { id: string; command: string } };

/**
 * Reiniciar aplica la ventana nueva; el motor nuevo entra cuando el viejo queda
 * sin trabajo. Con tareas vivas se dice cuántas y se ofrece detenerlas ya.
 */
function Aplicar() {
  const [vivas, setVivas] = createSignal<LiveTurn[]>([]);
  async function mirar() {
    const turnos = (await invoke("list_live_turns").catch(() => [])) as LiveTurn[];
    setVivas(turnos);
  }
  onMount(() => {
    void mirar();
    const reloj = setInterval(() => void mirar(), 10_000);
    onCleanup(() => clearInterval(reloj));
  });
  async function detenerYAplicar() {
    await stopTurns(vivas());
    void invoke("restart_app");
  }
  return (
    <>
      <Show when={vivas().length > 0}>
        <p class="m-0 basis-full text-xs text-neutral-500">
          {t("shell.update.waiting_tasks", { count: vivas().length })}
        </p>
      </Show>
      <Button variant="secondary" size="sm" onClick={() => void invoke("restart_app")}>
        {t("shell.update.restart")}
      </Button>
      <Show when={vivas().length > 0}>
        <Button variant="ghost" size="sm" onClick={() => void detenerYAplicar()}>
          {t("shell.update.stop_and_apply")}
        </Button>
      </Show>
    </>
  );
}
