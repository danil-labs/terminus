import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button } from "../../ui/Button";
import { Toast } from "../../ui/Toast";
import { t } from "../../lib/i18n";

/** El reinicio requiere una acción de la persona; descartar dura hasta otra versión. */
const CADA = 30 * 60 * 1000;
const AL_VOLVER = 10 * 60 * 1000;

export default function AvisoDeVersion() {
  const [fallo, setFallo] = createSignal(false);
  const [hay, setHay] = createSignal<Update | null>(null);
  const [alDia, setAlDia] = createSignal(false);
  const [estado, setEstado] = createSignal<"quieto" | "bajando" | "listo">("quieto");
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

  onMount(() => {
    void mirar();
    const reloj = setInterval(() => void mirar(), CADA);
    const volver = () => {
      if (document.visibilityState === "visible" && Date.now() - ultima > AL_VOLVER) void mirar();
    };
    window.addEventListener("focus", volver);
    document.addEventListener("visibilitychange", volver);
    onCleanup(() => {
      clearInterval(reloj);
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
      await reciente.downloadAndInstall();
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
              <Button
                variant="secondary"
                size="sm"
                class="justify-self-start"
                onClick={() => void relaunch()}
              >
                {t("shell.update.restart")}
              </Button>
            </Show>
          </Toast>
        )}
      </Show>
    </>
  );
}
