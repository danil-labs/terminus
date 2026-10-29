import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Button } from "../../ui/Button";
import { Toast } from "../../ui/Toast";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { quietFinished } from "./TaskNotifier";
import { cancelWait, namesOf, stopTurns, titled, waitRows, waitThen, waitingThen, type LiveTurn, type ShownTurn } from "./liveTurns";

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
          <Button variant="ghost" size="compact" onClick={() => setAlDia(false)}>{t("shell.update.later")}</Button>
        </Toast>
      </Show>
      <EsperaDeTareas />
      <Show when={instalada() && !instaladaVista() && !hay() && !waitingThen()}>
        <Toast>
          <p class="m-0 text-xs text-neutral-500">{t("shell.update.installed")}</p>
          <div class="flex flex-wrap gap-1.5">
            <Aplicar onLater={() => setInstaladaVista(true)} />
          </div>
        </Toast>
      </Show>
      <Show when={waitingThen() ? null : hay()}>
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
                <Button variant="primary" size="compact" onClick={() => void poner()}>
                  {t("shell.update.install")}
                </Button>
                <Button
                  variant="ghost"
                  size="compact"
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
              <div class="flex flex-wrap gap-1.5">
                <Aplicar
                  onLater={() => {
                    setDescartadas((d) => [...d, u().version]);
                    setHay(null);
                    setInstaladaVista(true);
                  }}
                />
              </div>
            </Show>
          </Toast>
        )}
      </Show>
    </>
  );
}

/**
 * Reiniciar aplica la ventana nueva; el motor nuevo entra cuando el viejo queda
 * sin trabajo. Con tareas vivas no se ofrece reiniciar ya: se espera a que
 * terminen, o se detienen después de ver cuáles se cortan.
 */
function Aplicar(props: { onLater: () => void }) {
  const [vivas, setVivas] = createSignal<LiveTurn[]>([]);
  const [confirmando, setConfirmando] = createSignal<ShownTurn[] | null>(null);
  const [deteniendo, setDeteniendo] = createSignal(false);
  const [fallo, setFallo] = createSignal(false);
  async function mirar() {
    const turnos = (await invoke("list_live_turns").catch(() => [])) as LiveTurn[];
    setVivas(turnos);
    return turnos;
  }
  onMount(() => {
    void mirar();
    const reloj = setInterval(() => void mirar(), 10_000);
    onCleanup(() => clearInterval(reloj));
  });
  async function reiniciar() {
    // Una tarea pudo arrancar desde la última mirada: entonces se ofrece esperar.
    if ((await mirar()).length === 0) void invoke("restart_app");
  }
  async function esperar() {
    waitThen("restart", await titled(vivas()));
  }
  async function confirmar() {
    setFallo(false);
    setConfirmando(await titled(await mirar()));
  }
  async function detenerYReiniciar() {
    setDeteniendo(true);
    setFallo(false);
    quietFinished();
    const resultados = await stopTurns(await mirar());
    setDeteniendo(false);
    if (resultados.some((r) => r.status === "rejected")) {
      setFallo(true);
      return;
    }
    void invoke("restart_app");
  }
  return (
    <Show
      when={vivas().length > 0}
      fallback={
        <>
          <Button variant="secondary" size="compact" onClick={() => void reiniciar()}>
            {t("shell.update.restart")}
          </Button>
          <Button variant="ghost" size="compact" onClick={props.onLater}>
            {t("shell.update.later")}
          </Button>
        </>
      }
    >
      <Show
        when={confirmando()}
        fallback={
          <>
            <p class="m-0 basis-full text-xs text-neutral-500">
              {t("shell.update.waiting_tasks", { count: vivas().length })}
            </p>
            <Button variant="primary" size="compact" onClick={() => void esperar()}>
              {t("shell.update.restart_when_done")}
            </Button>
            <Button variant="secondary" size="compact" onClick={() => void confirmar()}>
              {t("shell.update.stop_and_restart")}
            </Button>
            <Button variant="ghost" size="compact" onClick={props.onLater}>
              {t("shell.update.later")}
            </Button>
          </>
        }
      >
        {(filas) => (
          <>
            <p class="m-0 basis-full text-xs text-neutral-700" data-stop-confirm>
              {t("shell.update.stop_confirm", { count: filas().length, titles: namesOf(filas(), 5) })}
            </p>
            <Show when={fallo()}>
              <p class="m-0 basis-full text-xs text-warning-strong">{t("shell.update.stop_failed")}</p>
            </Show>
            <Button variant="danger" size="compact" disabled={deteniendo()} onClick={() => void detenerYReiniciar()}>
              {deteniendo() ? t("shell.close.stopping") : t("shell.update.stop_confirm_yes")}
            </Button>
            <Button variant="ghost" size="compact" disabled={deteniendo()} onClick={() => setConfirmando(null)}>
              {t("shell.update.stop_confirm_back")}
            </Button>
          </>
        )}
      </Show>
    </Show>
  );
}

/** Lo que se espera para reiniciar o salir: queda a la vista hasta que termina o se cancela. */
function EsperaDeTareas() {
  return (
    <Show when={waitingThen()}>
      {(then) => (
        <Toast data-wait-notice="">
          <p class="m-0 text-[0.8125rem] font-semibold">
            {then() === "restart" ? t("shell.wait.restart_title") : t("shell.wait.quit_title")}
          </p>
          <Show when={waitRows().length > 0}>
            <p class="m-0 text-xs text-neutral-500">
              {waitRows().some((row) => row.named)
                ? t("shell.wait.for", { titles: namesOf(waitRows()) })
                : t("shell.wait.for_count", { count: waitRows().length })}
            </p>
          </Show>
          <div class="flex gap-1.5">
            <Button variant="ghost" size="compact" onClick={cancelWait}>
              {t("shell.wait.cancel")}
            </Button>
          </div>
        </Toast>
      )}
    </Show>
  );
}
