/* @refresh reload */
// Antes que nada: sin los catálogos dentro, `t()` devuelve la clave.
import "../locales/catalogs";
import { render } from "solid-js/web";
import App from "./App";
import Setup from "../features/settings/Setup";
import Lanzador from "../features/shell/Launcher";
import { seguirElTema } from "../lib/theme";
import { aplicarEscala, atajoDeEscala } from "../lib/zoom";
import { trimNativeMenu } from "../lib/contextMenu";
import { activarBarrasAlDesplazar } from "../lib/scrollbars";
import { aplicarLengua, elegirLengua, lenguasDisponibles, semillaDelAlta } from "../lib/i18n";
import { cargarPaquetes } from "../locales/packs";
import "../styles/global.css";

/**
 * El arranque fija tema y lengua antes del primer pintado. Los efectos declaran
 * qué observan con `on(...)` y limpian, mediante `onCleanup`, junto a lo que
 * abren.
 */
seguirElTema();
aplicarEscala();
window.addEventListener("keydown", atajoDeEscala);
trimNativeMenu(window, import.meta.env.DEV);
activarBarrasAlDesplazar();
// Igual que el tema, y por el mismo motivo: leída después de montar, la ventana
// abriría en español y cambiaría de lengua delante de quien mira.
aplicarLengua();

/**
 * Las lenguas instaladas en el app data no viajan en el binario, y leerlas es
 * un `invoke` asíncrono. **Se espera solo cuando hay algo que esperar**: si la
 * lengua que toca ya está registrada —`es`, `en`, o «sistema» resolviendo a una
 * de las dos— se monta sin pagar nada y los paquetes entran por detrás; si no,
 * se lee el disco antes del primer pintado — montar antes enseñaría la ventana
 * un instante en español antes de que cambiara sola.
 *
 * `elegirLengua` después de cargar **vuelve a resolver**: la lengua se fijó al
 * evaluarse el motor, cuando el paquete todavía no estaba, y sin esto quedaría
 * en el respaldo aunque el catálogo ya esté dentro. Con la preferencia tal
 * cual, es idempotente.
 */
function laQueTocaYaEstaDentro(): boolean {
  const pref = semillaDelAlta();
  const pedido = pref === "sistema" ? navigator.language : pref;
  const registrada = (c: string) => lenguasDisponibles().some((m) => m.codigo === c);
  return registrada(pedido) || registrada(pedido.split("-")[0]);
}

const montar = () =>
  render(
    () => (
      // El lanzador va antes que todo: sin motor conectado no hay a quién preguntar.
      // La preparación va por fuera de la app: si falta git no hay nada útil detrás.
      <Lanzador>
        <Setup>
          <App />
        </Setup>
      </Lanzador>
    ),
    document.getElementById("root")!,
  );

const lenguasDeDisco = cargarPaquetes().then(() => elegirLengua(semillaDelAlta()));
// No un `await` de nivel superior: el objetivo del build es `es2020`, donde no
// existe, y subirlo por esta línea cambiaría el objetivo de la app entera.
if (laQueTocaYaEstaDentro()) montar();
// Si la lectura falla, se monta igual y en el respaldo: una ventana sin texto no
// deja hacer nada, y una en español sí.
else void lenguasDeDisco.catch(() => {}).then(montar);
