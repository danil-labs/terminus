import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Button } from "../../ui/Button";
import { Toast } from "../../ui/Toast";
import { t } from "../../lib/i18n";

/**
 * El aviso de que hay una versión nueva, abajo a la derecha.
 *
 * **Existe porque nadie entra a Configuración a buscar actualizaciones.** El
 * panel de «Estado del entorno» dice lo mismo, y sirve para quien va a mirar;
 * esto es para quien no va a ir. Sin ello, la app se actualiza solo si alguien
 * se acuerda de preguntar, que es como decir que no se actualiza.
 *
 * **Una tarjeta y no un modal.** Una versión nueva no es urgente —lo que estás
 * haciendo funciona igual—, así que interrumpir por ella cobra una atención que
 * no le corresponde y entrena a cerrar avisos sin leerlos.
 *
 * **Pregunta una vez al abrir y luego cada seis horas.** Ni en bucle —gastar red
 * de otro para contestar una pregunta que nadie hizo— ni una sola vez: una app
 * de escritorio se queda semanas abierta, y entonces solo se enteraría quien la
 * reinicia.
 *
 * **No reinicia solo.** Un turno en vuelo se pierde entero al cerrarse la app
 * —la respuesta y su registro de consumo se guardan al cerrar el turno— y quien
 * sabe si hay algo corriendo es quien está delante: se baja la versión y el
 * reinicio lo pulsa una persona.
 *
 * **Y descartar es descartar de verdad**, hasta la siguiente versión: un aviso
 * que reaparece a los diez minutos es el que la gente aprende a ignorar.
 */

/** Cada cuánto se vuelve a preguntar, en milisegundos. */
const CADA = 6 * 60 * 60 * 1000;

export default function AvisoDeVersion() {
  const [fallo, setFallo] = createSignal(false);
  const [hay, setHay] = createSignal<Update | null>(null);
  const [estado, setEstado] = createSignal<"quieto" | "bajando" | "listo">("quieto");
  /** Versiones que esta persona ya descartó. */
  const [descartadas, setDescartadas] = createSignal<string[]>([]);

  async function mirar() {
    try {
      const u = await check();
      // Descartada: no se vuelve a asomar por la misma versión.
      if (u && !descartadas().includes(u.version)) setHay(u);
    } catch {
      // Sin red no se sabe si hay versión nueva, y eso no es un fallo de la app:
      // no se pinta nada y se sigue trabajando.
    }
  }

  onMount(() => {
    void mirar();
    const reloj = setInterval(() => void mirar(), CADA);
    onCleanup(() => clearInterval(reloj));
  });

  async function poner() {
    const u = hay();
    if (!u || estado() !== "quieto") return;
    setFallo(false);
    setEstado("bajando");
    try {
      await u.downloadAndInstall();
      setEstado("listo");
    } catch {
      // Si falla la descarga, el aviso se queda: volver a intentarlo es del
      // botón, no de un reintento automático que nadie ve.
      setFallo(true);
      setEstado("quieto");
    }
  }

  return (
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
  );
}
