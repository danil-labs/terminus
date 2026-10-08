import Actualizacion from "./Update";
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { invoke } from "../../lib/invoke.ts";
import { listen } from "@tauri-apps/api/event";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import SquareArrowOutUpRight from "lucide-solid/icons/square-arrow-out-up-right";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import {
  ORIGEN_APP,
  ORIGEN_BUNDLE,
  ORIGEN_SISTEMA,
  type Dependency,
  type EnvReport,
  type Requirement,
} from "./environment-store";
import { MarcaAgente } from "../../ui/icons";
import { FailureNote, asFailure, type Failure } from "../../ui/Failure";
import { peso } from "../../lib/format";
import { Skeleton } from "../../ui/Skeleton";
import { RETARDO_TOOLTIP, TooltipContent, TooltipRoot, TooltipTrigger } from "../../ui/Tooltip";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/Button";
import { SettingsBlock, SettingsPanel, SettingsSection } from "./layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../../ui/Table";

type Columna = "label" | "version" | "location" | "bytes" | "source";

function tituloDe(id: Columna): string {
  switch (id) {
    case "label":
      return t("settings.environment.column.name");
    case "version":
      return t("settings.environment.column.version");
    case "location":
      return t("settings.environment.column.location");
    case "bytes":
      return t("settings.environment.column.size");
    case "source":
      return t("settings.environment.column.source");
  }
}

const COLUMNAS: { id: Columna; alinear?: "right"; ancho: string }[] = [
  { id: "label", ancho: "w-[20%]" },
  { id: "version", ancho: "w-[13%]" },
  { id: "location", ancho: "w-[26%]" },
  { id: "bytes", alinear: "right", ancho: "w-[9%]" },
  { id: "source", ancho: "w-[20%]" },
];

const BASE = ["git", "node", "npm", "pnpm", "bun", "agent-browser"];
type Fila = Requirement & { dependency?: Dependency };

export default function Environment() {
  const [filas, setFilas] = createSignal<Dependency[]>([]);
  const [reporte, setReporte] = createSignal<EnvReport | null>(null);
  const [cargando, setCargando] = createSignal(true);
  const [fallo, setFallo] = createSignal<Failure | null>(null);
  const [preparando, setPreparando] = createSignal<string | null>(null);
  const [orden, setOrden] = createSignal<{ columna: Columna; direccion: "asc" | "desc" }>({
    columna: "bytes",
    direccion: "desc",
  });

  async function cargar(force = false) {
    setCargando(true);
    setFallo(null);
    try {
      const [deps, env] = await Promise.all([
        invoke<Dependency[]>("list_dependencies", { force }),
        invoke<EnvReport>("check_environment", { force }),
      ]);
      setFilas(deps);
      setReporte(env);
    } catch (e) {
      setFallo({ ...asFailure(e), what: t("settings.environment.error_check") });
    } finally {
      setCargando(false);
    }
  }

  onMount(() => {
    void cargar();

    const cambios = listen("agents", () => void cargar(true));
    onCleanup(() => void cambios.then((f) => f()));
    const toolchain = listen("toolchain", () => void cargar(true));
    onCleanup(() => void toolchain.then((f) => f()));
    const bootstrap = listen("bootstrap", () => void cargar(true));
    onCleanup(() => void bootstrap.then((f) => f()));
  });

  function alternar(columna: Columna) {
    setOrden((o) =>
      o.columna === columna
        ? { columna, direccion: o.direccion === "asc" ? "desc" : "asc" }
        : { columna, direccion: columna === "bytes" ? "desc" : "asc" },
    );
  }

  const ordenadas = createMemo(() => {
    const { columna, direccion } = orden();
    const signo = direccion === "asc" ? 1 : -1;
    const dependencies = new Map(filas().map((fila) => [fila.id, fila]));
    const rows: Fila[] = (reporte()?.items ?? []).map((fila) => ({
      ...fila,
      dependency: dependencies.get(fila.id),
    }));
    return rows.sort((a, b) => {
      if (columna === "bytes") {
        return signo * ((a.dependency?.bytes ?? a.bytes ?? -1) - (b.dependency?.bytes ?? b.bytes ?? -1));
      }
      const value = (row: Fila) => {
        switch (columna) {
          case "label": return row.label;
          case "version": return row.dependency?.version ?? "";
          case "location": return row.dependency?.location ?? "";
          case "source": return row.source ?? "";
        }
      };
      return signo * value(a).localeCompare(value(b));
    });
  });

  async function revelar(d: Dependency) {
    await invoke("open_external", { target: d.location }).catch(() => {});
  }

  function origin(source: string | null) {
    if (source === ORIGEN_SISTEMA) return t("settings.environment.origin.system");
    if (source === ORIGEN_APP) return t("settings.environment.origin.app");
    if (source === ORIGEN_BUNDLE) return t("settings.environment.origin.bundle");
    return t("settings.environment.origin.missing");
  }

  const pending = (fila: Fila) => reporte()?.bootstrap.includes(fila.id) === true;
  const canPrepare = (fila: Fila) => BASE.includes(fila.id) && pending(fila);
  const status = (fila: Fila) => {
    if (fila.timed_out) return t("settings.environment.status.timed_out");
    if (!fila.ok) return t("settings.environment.status.missing");
    if (pending(fila)) return t("settings.environment.status.update");
    return t("settings.environment.status.ready");
  };

  async function preparar(fila: Fila) {
    setPreparando(fila.id);
    setFallo(null);
    try {
      await invoke("install_base_tool", { tool: fila.id });
      await cargar(true);
    } catch (e) {
      setFallo({ ...asFailure(e), what: t("settings.environment.error_prepare") });
    } finally {
      setPreparando(null);
    }
  }

  return (
    <SettingsPanel>
      <Actualizacion build={reporte()?.build} />

      <SettingsSection
        title={t("settings.environment.title")}
        description={t("settings.environment.intro")}
        aside={
          <Button
            variant="ghost"
            size="compact"
            disabled={cargando()}
            aria-label={t("settings.environment.recheck")}
            title={t("settings.environment.recheck")}
            onClick={() => void cargar(true)}
          >
            <RefreshCw size={13} class={cn(cargando() && "animate-spin")} />
            {t("settings.environment.recheck")}
          </Button>
        }
      >
        <Show when={cargando() && filas().length === 0}>
          <SettingsBlock>
            <Skeleton filas={4} />
          </SettingsBlock>
        </Show>

        <Show when={fallo()}>
          {(f) => (
            <SettingsBlock>
              <FailureNote f={f()} />
            </SettingsBlock>
          )}
        </Show>

        <Show when={reporte()?.reason}>
          {(razon) => (
            <SettingsBlock>
              <p class="m-0 border-l-2 border-warning px-2.5 py-1.5 text-[0.8125rem] text-neutral-500">
                {razon()}
              </p>
            </SettingsBlock>
          )}
        </Show>

        <Show when={(reporte()?.items.length ?? 0) > 0}>
          <SettingsBlock>
            <div
              class={cn(
                "overflow-x-auto rounded-lg border border-border transition-opacity",
                cargando() && "pointer-events-none opacity-60",
              )}
            >
              <Table class="table-fixed">
                <TableHead>
                  <TableRow>
                    <For each={COLUMNAS}>
                      {(c) => (
                        <TableHeaderCell
                          class={cn(
                            c.ancho,
                            "cursor-pointer text-xs tracking-normal normal-case select-none",
                            c.alinear === "right" && "text-right",
                          )}
                          aria-sort={
                            orden().columna === c.id
                              ? orden().direccion === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                          onClick={() => alternar(c.id)}
                        >
                          <span
                            class={cn(
                              "inline-flex items-center gap-0.5",
                              c.alinear === "right" && "flex-row-reverse",
                            )}
                          >
                            {tituloDe(c.id)}
                            <Show when={orden().columna === c.id}>
                              {orden().direccion === "asc" ? (
                                <ChevronUp size={12} />
                              ) : (
                                <ChevronDown size={12} />
                              )}
                            </Show>
                          </span>
                        </TableHeaderCell>
                      )}
                    </For>
                    <TableHeaderCell class="w-[12%] text-right">
                      <span class="sr-only">{t("settings.environment.column.action")}</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <For each={ordenadas()}>
                    {(d) => (
                      <TableRow class="group">
                        <TableCell class="truncate text-sm">
                          <span class="flex min-w-0 items-center gap-1.5">
                            <MarcaAgente id={d.id} size={14} />
                            <span class="truncate">{d.label}</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <TooltipRoot openDelay={RETARDO_TOOLTIP} placement="top">
                            <TooltipTrigger
                              as="span"
                              class="block min-w-0 truncate text-left font-mono text-xs text-neutral-500"
                            >
                              {d.dependency?.version ?? "—"}
                            </TooltipTrigger>
                            <TooltipContent>{d.dependency?.version ?? "—"}</TooltipContent>
                          </TooltipRoot>
                          <Show when={d.source !== ORIGEN_SISTEMA && reporte()?.runtimeVersions[d.id]}>
                            {(version) => (
                              <span class="block truncate text-[0.6875rem] text-neutral-500">
                                {t("settings.environment.required_version", { version: version() })}
                              </span>
                            )}
                          </Show>
                        </TableCell>
                        <TableCell>
                          <span class="flex min-w-0 items-center gap-1">
                            <span class="min-w-0 flex-1 truncate font-mono text-xs text-neutral-500">
                              {d.dependency?.location ?? "—"}
                            </span>
                            <Show when={d.dependency}>
                              {(dependency) => (
                                <button
                                  type="button"
                                  class="grid size-5 shrink-0 place-items-center rounded-sm text-neutral-500 opacity-0 outline-none focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:bg-surface-muted hover:text-neutral-950 group-hover:opacity-100 group-focus-within:opacity-100"
                                  aria-label={t("settings.environment.reveal_location", {
                                    label: d.label,
                                  })}
                                  title={t("settings.environment.reveal_location", { label: d.label })}
                                  onClick={() => void revelar(dependency())}
                                >
                                  <SquareArrowOutUpRight size={12} />
                                </button>
                              )}
                            </Show>
                          </span>
                        </TableCell>
                        <TableCell class="whitespace-nowrap text-right font-mono text-xs text-neutral-500">
                          {d.dependency?.bytes ?? d.bytes ? peso(d.dependency?.bytes ?? d.bytes ?? 0) : "—"}
                        </TableCell>
                        <TableCell class="text-xs text-neutral-500">
                          <span class="block truncate">{origin(d.source)}</span>
                          <span class={cn("block truncate text-[0.6875rem]", pending(d) && "text-warning")}>
                            {status(d)}
                          </span>
                        </TableCell>
                        <TableCell class="text-right">
                          <Show when={canPrepare(d)}>
                            <Button
                              size="compact"
                              variant="secondary"
                              disabled={preparando() !== null}
                              onClick={() => void preparar(d)}
                            >
                              {preparando() === d.id
                                ? t("settings.environment.preparing")
                                : d.ok
                                  ? t("settings.environment.update")
                                  : t("settings.environment.repair")}
                            </Button>
                          </Show>
                        </TableCell>
                      </TableRow>
                    )}
                  </For>
                </TableBody>
              </Table>
            </div>
          </SettingsBlock>
        </Show>
      </SettingsSection>
    </SettingsPanel>
  );
}
