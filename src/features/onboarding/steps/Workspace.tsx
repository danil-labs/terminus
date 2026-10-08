import { createSignal } from "solid-js";
import { invoke } from "../../../lib/invoke.ts";
import { t } from "../../../lib/i18n";
import { Input } from "../../../ui/Input";
import { Lengua } from "../../settings/Language";
import { Pantalla } from "../Screen";
import { prosaDe } from "../../../ui/Failure";
import { crearWorkspace, type Alta } from "../onboarding-store";

/** Paso 3: el nombre crea la carpeta del workspace, y la lengua elegida aquí queda como la suya. */
export default function Espacio(props: { alta: Alta; nueva: boolean; onCancelar?: () => void }) {
  const [creando, setCreando] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const e = props.alta.estado;
  const nombre = () => e.nombre.trim();

  async function seguir() {
    if (!nombre() || creando()) return;
    setCreando(true);
    setError(null);
    try {
      const creado = e.workspace;
      if (creado) {
        if (creado.nombre !== nombre()) {
          await invoke("rename_workspace", { id: creado.id, name: nombre() });
          props.alta.set("workspace", { id: creado.id, nombre: nombre() });
          window.dispatchEvent(new CustomEvent("harness:workspace"));
        }
      } else {
        const w = await crearWorkspace(nombre());
        props.alta.set("workspace", { id: w.id, nombre: nombre() });
      }
      props.alta.set("paso", "accounts");
    } catch (x) {
      setError(prosaDe(x));
    } finally {
      setCreando(false);
    }
  }

  const rotulo = () => {
    if (creando()) return t("onboarding.workspace.creating");
    return e.workspace ? t("onboarding.continue") : t("onboarding.workspace.create");
  };

  return (
    <Pantalla
      titulo={props.nueva ? t("onboarding.workspace.title.new") : t("onboarding.workspace.title.first")}
      lede={t("onboarding.workspace.lede")}
      pie={t("onboarding.workspace.footer")}
      atras={props.nueva ? props.onCancelar : () => props.alta.set("paso", "agents")}
      atrasRotulo={props.nueva ? t("onboarding.cancel") : undefined}
      primario={{ rotulo: rotulo(), onClick: () => void seguir(), disabled: !nombre() || creando() }}
      error={error()}
    >
      <form
        class="grid gap-6"
        onSubmit={(ev) => {
          ev.preventDefault();
          void seguir();
        }}
      >
        <label class="grid gap-1.5">
          <span class="text-[0.8125rem] font-semibold">{t("onboarding.workspace.name")}</span>
          <Input value={e.nombre} onInput={(ev) => props.alta.set("nombre", ev.currentTarget.value)} />
          <small class="text-xs text-neutral-500">{t("onboarding.workspace.hint")}</small>
        </label>
        <Lengua />
        <p class="m-0 rounded-md border border-border bg-surface-muted px-4 py-3 text-sm text-neutral-500">
          {t("onboarding.workspace.notice")}
        </p>
      </form>
    </Pantalla>
  );
}
