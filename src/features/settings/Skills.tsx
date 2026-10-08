import { createSignal, For, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { flechaDeLista } from "../../lib/shortcuts";
import { cn } from "../../lib/utils";
import { SettingsPanel } from "./layout";
import ProveedorDeMemoria from "./MemoryProvider";
import { FuentesDeSkills } from "./SkillSources";
import { SkillsDeFuentes } from "./SourceSkills";
import Herramientas from "./Tools";

/**
 * Lo que la persona añade para que el agente pueda más, en dos pestañas.
 *
 * Apiladas, los servidores MCP quedaban debajo de ochenta filas de skills y no
 * se llegaba a ellos. Cada pestaña es una clase de extensión, no una fase de un
 * mismo flujo: se entra a la que se busca, no se recorren en orden.
 */
type Pestana = "skills" | "mcp";

// El nombre es una función y no una cadena: `t()` con una variable dentro deja
// ciego a `scripts/locales.mjs`, que solo lee literales en el sitio de la
// llamada. Y evaluado al importar, la pestaña se congela en la lengua de carga.
const PESTANAS: { id: Pestana; nombre: () => string }[] = [
  { id: "skills", nombre: () => t("settings.skills.tab_skills") },
  { id: "mcp", nombre: () => t("settings.skills.tab_mcp") },
];

export default function Skills() {
  const [activa, setActiva] = createSignal<Pestana>("skills");

  // Las flechas mueven entre pestañas, que es lo que un `tablist` promete al
  // anunciarse como tal. Sin esto, el rol miente.
  function mover(e: KeyboardEvent) {
    if (!flechaDeLista(e)) return;
    const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (paso === 0) return;
    e.preventDefault();
    const i = PESTANAS.findIndex((p) => p.id === activa());
    setActiva(PESTANAS[(i + paso + PESTANAS.length) % PESTANAS.length].id);
  }

  return (
    <SettingsPanel>
      <div
        role="tablist"
        aria-label={t("settings.skills.tabs_label")}
        onKeyDown={mover}
        class="flex items-end gap-5 border-0 border-b border-border border-solid"
      >
        <For each={PESTANAS}>
          {(p) => (
            <button
              type="button"
              role="tab"
              id={`skills-tab-${p.id}`}
              aria-selected={activa() === p.id}
              aria-controls="skills-panel"
              tabindex={activa() === p.id ? 0 : -1}
              onClick={() => setActiva(p.id)}
              class={cn(
                "-mb-px border-0 border-b-2 border-solid border-transparent bg-transparent px-0 pt-0 pb-2 text-sm text-neutral-500 hover:text-neutral-950",
                activa() === p.id && "border-primary font-semibold text-neutral-950",
              )}
            >
              {p.nombre()}
            </button>
          )}
        </For>
      </div>

      <SettingsPanel
        id="skills-panel"
        role="tabpanel"
        aria-labelledby={`skills-tab-${activa()}`}
      >
        <Show when={activa() === "skills"}>
          <FuentesDeSkills />
          <SkillsDeFuentes />
        </Show>
        <Show when={activa() === "mcp"}>
          <Herramientas />
          <ProveedorDeMemoria />
        </Show>
      </SettingsPanel>
    </SettingsPanel>
  );
}
