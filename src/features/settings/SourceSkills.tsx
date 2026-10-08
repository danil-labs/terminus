import { invoke } from "../../lib/invoke.ts";
import { confirm } from "@tauri-apps/plugin-dialog";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { asFailure, type Failure, FailureNote } from "../../ui/Failure";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Toggle } from "../../ui/Toggle";
import { EmptyState } from "../../ui/EmptyState";
import Search from "lucide-solid/icons/search";
import { SettingsRow, SettingsSection } from "./layout";
import { lockedBy } from "../../lib/governance";
import { Governed } from "./Governed";

/** Una skill que ofrece una carpeta adjunta. La compone `practices::SkillDeFuente`. */
type SkillDeFuente = {
  source: string;
  source_name: string;
  name: string;
  description: string;
  enabled: boolean;
  origin: string;
  /** Qué agentes la leen. Lo decide la carpeta en que está, no esta pantalla. */
  agents: string[];
};

export function SkillsDeFuentes() {
  const [skills, setSkills] = createSignal<SkillDeFuente[]>([]);
  const [ocupada, setOcupada] = createSignal<string | null>(null);
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  const [busca, setBusca] = createSignal("");

  const clave = (s: SkillDeFuente) => `${s.source}/${s.name}`;

  // Sin locale: es comparar identificadores, no ordenar para una persona. Con
  // `tr`, la `I` de una skill baja a `ı` y deja de encontrarse.
  const visibles = createMemo(() => {
    const q = busca().trim().toLowerCase();
    if (!q) return skills();
    return skills().filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.source_name.toLowerCase().includes(q) ||
        s.agents.some((a) => a.toLowerCase().includes(q)),
    );
  });

  const encendidas = createMemo(() => skills().filter((s) => s.enabled).length);
  const apagadasVisibles = createMemo(() => visibles().filter((s) => !s.enabled));

  // Cuántos agentes hay en total, para saber cuándo una skill es de todos sin
  // enumerarlos. Sale de las propias filas: la lista de agentes es de Rust.
  const agentes = createMemo(() =>
    Math.max(0, ...skills().map((s) => s.agents.length)),
  );

  async function refrescar() {
    setSkills(await invoke<SkillDeFuente[]>("list_source_skills"));
  }

  async function alternar(s: SkillDeFuente) {
    setOcupada(clave(s));
    setFallo(null);
    try {
      await invoke("set_source_skill", {
        source: s.source,
        skill: s.name,
        on: !s.enabled,
      });
      await refrescar();
    } catch (error) {
      setFallo({ ...asFailure(error), what: t("settings.skills.error_source") });
    } finally {
      setOcupada(null);
    }
  }

  // Borra del repositorio de la persona, no de una copia nuestra. Se avisa
  // antes: apagar es reversible y esto no, y quien lo use en otro editor deja
  // de tenerla.
  async function desinstalar(s: SkillDeFuente) {
    if (
      !(await confirm(
        t("settings.skills.uninstall_confirm", { name: s.name, path: s.origin }),
        { kind: "warning" },
      ))
    ) {
      return;
    }
    setOcupada(clave(s));
    setFallo(null);
    try {
      await invoke("uninstall_source_skill", { source: s.source, skill: s.name });
      await refrescar();
    } catch (error) {
      setFallo({ ...asFailure(error), what: t("settings.skills.error_uninstall") });
    } finally {
      setOcupada(null);
    }
  }

  // En bloque sobre lo que se ve, no sobre todo: con ochenta filas, buscar y
  // encender lo filtrado es el gesto; un «encender todas» a secas enciende
  // ochenta capacidades de una vez.
  async function alternarVisibles(on: boolean) {
    const objetivo = visibles().filter((s) => s.enabled !== on);
    if (objetivo.length === 0) return;
    setOcupada("*");
    setFallo(null);
    try {
      for (const s of objetivo) {
        await invoke("set_source_skill", { source: s.source, skill: s.name, on });
      }
      await refrescar();
    } catch (error) {
      setFallo({ ...asFailure(error), what: t("settings.skills.error_source") });
    } finally {
      setOcupada(null);
    }
  }

  onMount(() => void refrescar().catch((error) => setFallo(asFailure(error))));

  return (
    <SettingsSection
      title={t("settings.skills.sources_title")}
      aside={
        <Show when={skills().length > 0}>
          <span class="shrink-0 text-xs text-neutral-500">
            {t("settings.skills.on_of", {
              on: encendidas(),
              total: skills().length,
            })}
          </span>
          <div class="relative w-56 shrink-0">
            <Search
              size={14}
              class="pointer-events-none absolute top-1/2 left-[11px] -translate-y-1/2 text-neutral-500"
            />
            <Input
              value={busca()}
              onInput={(e) => setBusca(e.currentTarget.value)}
              placeholder={t("settings.skills.search")}
              aria-label={t("settings.skills.search")}
              class="pl-8"
            />
          </div>
          <Button
            variant="ghost"
            size="compact"
            disabled={ocupada() !== null || visibles().length === 0 || lockedBy("context_sources") !== null}
            onClick={() => void alternarVisibles(apagadasVisibles().length > 0)}
          >
            {apagadasVisibles().length > 0
              ? t("settings.skills.turn_on_n", { count: apagadasVisibles().length })
              : t("settings.skills.turn_off_n", { count: visibles().length })}
          </Button>
        </Show>
      }
    >
      <Show when={fallo()}>{(error) => <FailureNote f={error()} />}</Show>

      <Show
        when={skills().length > 0}
        fallback={
          <EmptyState
            title={t("settings.skills.sources_empty")}
            description={t("settings.skills.sources_empty_help")}
          />
        }
      >
        <Governed section="context_sources">
        <For each={visibles()}>
          {(s) => (
            <SettingsRow
              label={
                <span class="block truncate" title={s.description || undefined}>
                  {s.name}
                </span>
              }
              description={
                // La ruta es lo que se puede ir a mirar y editar, y lo que dice
                // que la skill no es de esta app.
                <span class="block truncate" title={s.origin}>
                  {s.source_name}
                </span>
              }
            >
              {/* Quién la lee lo decide su carpeta: sin decirlo, alguien
                  enciende para Claude una skill que solo carga Codex. */}
              <span class="flex flex-wrap justify-end gap-1">
                <Show
                  when={s.agents.length !== agentes()}
                  fallback={<Badge>{t("settings.skills.all_agents")}</Badge>}
                >
                  <For each={s.agents}>{(a) => <Badge forma="dato">{a}</Badge>}</For>
                </Show>
              </span>
              <Toggle
                checked={s.enabled}
                disabled={ocupada() !== null}
                label={s.name}
                onChange={() => void alternar(s)}
              />
              <Button
                variant="ghost"
                size="compact"
                disabled={ocupada() !== null}
                onClick={() => void desinstalar(s)}
              >
                {t("settings.skills.uninstall")}
              </Button>
            </SettingsRow>
          )}
        </For>
        </Governed>
      </Show>
    </SettingsSection>
  );
}
