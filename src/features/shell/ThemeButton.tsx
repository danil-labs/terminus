import { Show, createSignal } from "solid-js";
import { t } from "../../lib/i18n";
import Sun from "lucide-solid/icons/sun";
import Moon from "lucide-solid/icons/moon";
import Monitor from "lucide-solid/icons/monitor";
import { apariencia, elegirApariencia, type Apariencia } from "../../lib/theme";

/**
 * Claro, oscuro y seguir al sistema, en **un botón que cicla**.
 *
 * **Un botón y no un conmutador de tres, y eso es lo que se pidió.** Tres
 * segmentos cuestan el ancho de los tres estados en una franja donde la versión
 * ya se recorta antes que empujar nada (`PieVersion`), y en el pie de la ventana
 * se pulsa de vez en cuando: no hace falta llegar de un salto al que no es el
 * siguiente. Cada clic avanza uno.
 *
 * **El icono es el estado, no el destino.** Enseñar a dónde vas obliga a leer el
 * botón dos veces —«¿esto es lo que hay o lo que va a pasar?»— y con tres
 * estados eso no se resuelve mirando. Lo que va a pasar lo dice el `title`, que
 * es donde se pregunta.
 *
 * El orden es claro → oscuro → sistema, que es de lo más elegido a lo menos: el
 * ciclo se recorre hacia adelante, y quien quiera el de fábrica llega en dos
 * clics desde cualquier sitio.
 *
 * No guarda nada por su cuenta: `lib/theme.ts` es quien decide y quien persiste
 * —en `localStorage`, porque leerlo tiene que ser síncrono antes del primer
 * pintado—. Aquí solo se cicla.
 */
const SIGUIENTE: Record<Apariencia, Apariencia> = {
  claro: "oscuro",
  oscuro: "sistema",
  sistema: "claro",
};

/**
 * Cómo se llama cada apariencia, **del catálogo**.
 *
 * Dos formas, y las dos las escribe quien traduce: la que nombra el estado
 * («Oscuro») y la que se pega detrás de «pulsa para» («oscuro»). Se escribían
 * con un `.toLowerCase()` sobre la primera, que es exactamente lo que
 * `CLAUDE.md` prohíbe: sin locale, con la interfaz en turco la `I` baja a `ı`,
 * y en una lengua donde la minúscula no es la forma correcta el resultado no
 * es que se vea raro — es que está mal escrito y nada avisa.
 */
function comoSeLlama(a: Apariencia): string {
  switch (a) {
    case "claro":
      return t("shell.theme.name.light");
    case "oscuro":
      return t("shell.theme.name.dark");
    case "sistema":
      return t("shell.theme.name.system");
  }
}

function laSiguiente(a: Apariencia): string {
  switch (a) {
    case "claro":
      return t("shell.theme.next.light");
    case "oscuro":
      return t("shell.theme.next.dark");
    case "sistema":
      return t("shell.theme.next.system");
  }
}

export default function BotonDeTema() {
  const [tema, setTema] = createSignal<Apariencia>(apariencia());
  const rotulo = () =>
    t("shell.theme.title", {
      current: comoSeLlama(tema()),
      next: laSiguiente(SIGUIENTE[tema()]),
    });

  return (
    <button
      type="button"
      class="grid size-5 shrink-0 place-items-center rounded-sm text-neutral-500 outline-none hover:bg-surface-muted hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      // Dice lo que hay **y** lo que va a pasar: el icono solo puede con lo
      // primero, y sin lo segundo un botón que cicla se prueba a ver qué hace.
      //
      // **La misma frase para el tooltip y para el lector de pantalla.** Eran
      // dos, y la del lector componía «cambiar a» + el nombre, que en español
      // daba «a el del sistema». Una frase entera en el catálogo no puede tener
      // ese defecto, porque no se compone: se escribe.
      title={rotulo()}
      aria-label={rotulo()}
      onClick={() => setTema(elegirApariencia(SIGUIENTE[tema()]))}
    >
      <Show when={tema() === "claro"}>
        <Sun size={12} />
      </Show>
      <Show when={tema() === "oscuro"}>
        <Moon size={12} />
      </Show>
      <Show when={tema() === "sistema"}>
        <Monitor size={12} />
      </Show>
    </button>
  );
}
