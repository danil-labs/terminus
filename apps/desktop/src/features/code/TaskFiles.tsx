import { For, Show, Suspense, createResource, createSignal, onCleanup, onMount } from "solid-js";
import Ellipsis from "lucide-solid/icons/ellipsis";
import GitCompare from "lucide-solid/icons/git-compare";
import ListTree from "lucide-solid/icons/list-tree";
import Maximize2 from "lucide-solid/icons/maximize-2";
import MessageSquare from "lucide-solid/icons/message-square";
import Minimize2 from "lucide-solid/icons/minimize-2";
import X from "lucide-solid/icons/x";
import { capabilities } from "../../lib/platform";
import { arbolesDe } from "./treeKind";
import { Button } from "../../ui/Button";
import { ITEM_DE_MENU, Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { t } from "../../lib/i18n";
import { invoke } from "../../lib/invoke.ts";
import { cn } from "../../lib/utils";
import type { ArbolEnTarea } from "../../lib/model";
import type { TaskFiles } from "../../lib/taskFiles";
import { machineOf } from "../machines/store";
import type { Cambios } from "./Changes";
import Codigo from "./Code";
import VisorDeArchivo from "./FileViewer";
import { IconoDeArchivo } from "./FileIcon";
import { alMoverseElArbol } from "./refresh";

const nameOf = (path: string) => path.split("/").pop() ?? path;
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");
const MARK: Record<string, string> = { A: "text-success-strong", M: "text-warning-strong", D: "text-error-strong", R: "text-info-strong" };

/** The files panel that lives inside a task, beside its chat. */
export default function TaskFilesCard(props: {
  project: string;
  session: string;
  files: TaskFiles;
  visible: boolean;
  /** In a split view or a narrow window the panel only exists expanded. */
  expandedOnly: boolean;
  onSaved: () => void;
  onMoved: (session: string, tree: string, from: string, to: string) => void;
  onRemoved: (session: string, tree: string, path: string) => void;
}) {
  const panel = () => props.files.panel(props.session);
  const hasTabs = () => panel().tabs.length > 0;
  const expanded = () => panel().expanded || (props.expandedOnly && hasTabs());
  // Narrow, the card shows the tree or the viewer, never both side by side.
  let root: HTMLElement | undefined;
  const [narrow, setNarrow] = createSignal(false);
  // What a narrow card shows; the wide card's tree preference stays untouched.
  const [narrowView, setNarrowView] = createSignal<"viewer" | "tree">("viewer");
  onMount(() => {
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < 560));
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });
  const showViewer = () => hasTabs() && (!narrow() || narrowView() === "viewer");
  const showTree = () => !hasTabs() || (narrow() ? narrowView() === "tree" : panel().tree);
  const treePressed = () => (narrow() ? narrowView() === "tree" : panel().tree);
  const toggleTree = () => (narrow()
    ? setNarrowView((view) => (view === "tree" ? "viewer" : "tree"))
    : props.files.setTree(props.session, !panel().tree));
  const [menu, setMenu] = createSignal(false);

  const open = (tree: string, path: string, changes: boolean, pinned = false, changed = changes) => {
    props.files.open(props.session, { tree, path, changes, changed, pinned });
    if (narrow()) setNarrowView("viewer");
  };

  // The file is on this computer: it can be opened or shown here, and downloading it makes no sense.
  const here = () => capabilities().nativeWindow && !machineOf(props.session);
  const activeTab = () => panel().tabs.find((tab) => tab.id === panel().active);
  const absolute = async (tab: { tree: string; path: string }) => {
    const tree = (await arbolesDe(props.project, props.session)).find((item) => item.key === tab.tree);
    if (!tree) return null;
    const sep = tree.path.includes("\\") ? "\\" : "/";
    return `${tree.path.replace(/[\\/]$/, "")}${sep}${tab.path.split("/").join(sep)}`;
  };
  const openOutside = async () => {
    const tab = activeTab();
    if (!tab) return;
    await invoke("tree_open_external", { project: props.project, session: props.session, tree: tab.tree, path: tab.path }, machineOf(props.session)).catch(() => {});
  };
  const showInFolder = async () => {
    const tab = activeTab();
    const path = tab && (await absolute(tab));
    if (!path) return;
    const folder = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
    await invoke("open_external", { target: folder }).catch(() => {});
  };
  const download = async () => {
    const tab = activeTab();
    if (!tab) return;
    const content = await invoke<{ kind: string; text: string; data_url: string | null; pdf: string | null }>("tree_show",
      { project: props.project, session: props.session, tree: tab.tree, path: tab.path }, machineOf(props.session)).catch(() => null);
    if (!content) return;
    const blob = content.pdf
      ? new Blob([Uint8Array.from(atob(content.pdf), (c) => c.charCodeAt(0))], { type: "application/pdf" })
      : content.data_url ? await (await fetch(content.data_url)).blob() : new Blob([content.text]);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = nameOf(tab.path);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const tool = "size-6 shrink-0 p-0 text-neutral-500";
  const tools = () => (
    <div class="ml-auto flex shrink-0 items-center gap-1.5 pr-1.5">
      <Show when={hasTabs()}>
        <Button variant={treePressed() ? "secondary" : "ghost"} size="iconCompact" class={tool}
          title={t("code.panel.tree")} aria-label={t("code.panel.tree")} aria-pressed={treePressed()}
          onClick={toggleTree}><ListTree size={15} /></Button>
      </Show>
      <Popover open={menu()} onOpenChange={setMenu} placement="bottom-end">
        <PopoverTrigger as={(trigger: object) => <Button {...trigger} type="button" variant="ghost" size="iconCompact" class={tool}
          title={t("code.panel.more")} aria-label={t("code.panel.more")}><Ellipsis size={15} /></Button>} />
        <PopoverContent class="w-56 p-1">
          <Show when={activeTab() && here()}>
            <button type="button" class={ITEM_DE_MENU} onClick={() => { setMenu(false); void openOutside(); }}>{t("code.file.open_external")}</button>
            <button type="button" class={ITEM_DE_MENU} onClick={() => { setMenu(false); void showInFolder(); }}>{t("code.panel.show_in_folder")}</button>
          </Show>
          <Show when={activeTab() && !here()}>
            <button type="button" class={ITEM_DE_MENU} onClick={() => { setMenu(false); void download(); }}>{t("code.panel.download")}</button>
          </Show>
          <Show when={activeTab()}><div class="my-1 h-px bg-border" /></Show>
          <button type="button" class={ITEM_DE_MENU} disabled={!hasTabs()}
            onClick={() => { props.files.close(props.session, panel().tabs.map((tab) => tab.id)); setMenu(false); }}>
            {t("code.panel.close_all")}
          </button>
        </PopoverContent>
      </Popover>
      <Show when={hasTabs() && !props.expandedOnly}>
        <Button variant="ghost" size="iconCompact" class={tool}
          title={expanded() ? t("code.panel.collapse") : t("code.panel.expand")} aria-label={expanded() ? t("code.panel.collapse") : t("code.panel.expand")}
          onClick={() => props.files.setExpanded(props.session, !expanded())}>
          <Show when={expanded()} fallback={<Maximize2 size={15} />}><Minimize2 size={15} /></Show>
        </Button>
      </Show>
      <Show when={props.expandedOnly}>
        <Button variant="ghost" size="iconCompact" class={tool} title={t("code.panel.collapse")} aria-label={t("code.panel.collapse")}
          onClick={() => props.files.setOpen(props.session, false)}><MessageSquare size={15} /></Button>
      </Show>
    </div>
  );

  return (
    <section ref={root} class="@container relative flex h-full min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface shadow-md" data-task-files>
      <Show when={hasTabs()}>
        <div class="flex min-w-0 flex-1 flex-col" classList={{ hidden: !showViewer() }}>
          <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border pl-1.5">
            <div class="flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none]" role="tablist">
              <For each={panel().tabs}>{(tab) => {
                const active = () => panel().active === tab.id;
                const dirty = () => panel().dirty.includes(tab.id);
                return (
                  <div role="tab" aria-selected={active()} title={tab.pinned ? tab.path : t("code.panel.tab.preview")}
                    class={cn("group flex h-7 max-w-[200px] shrink-0 cursor-default items-center gap-1.5 rounded-[var(--radius-sm)] pr-1 pl-2 font-mono text-[0.75rem] select-none",
                      active() ? "bg-surface-muted font-semibold text-neutral-950" : "font-medium text-neutral-500 hover:bg-neutral-950/5 hover:text-neutral-950")}
                    onClick={() => props.files.activate(props.session, tab.id)}
                    onDblClick={() => props.files.pin(props.session, tab.id)}
                    onAuxClick={() => props.files.close(props.session, [tab.id])}>
                    <Show when={tab.changes} fallback={<IconoDeArchivo ruta={tab.path} class="shrink-0 text-neutral-500" />}>
                      <GitCompare size={13} class="shrink-0 text-neutral-500" />
                    </Show>
                    <span class="min-w-0 truncate" classList={{ italic: !tab.pinned }}>{nameOf(tab.path)}</span>
                    <Show when={tab.changes}><span class="shrink-0 font-sans text-[0.6875rem] font-normal text-neutral-500">{t("code.panel.side.changes")}</span></Show>
                    <button type="button" aria-label={t("code.panel.tab.close")}
                      class={cn("grid size-5 shrink-0 place-items-center rounded-sm text-neutral-500 hover:bg-neutral-200",
                        !active() && !dirty() && "opacity-0 group-hover:opacity-100")}
                      onClick={(event) => { event.stopPropagation(); props.files.close(props.session, [tab.id]); }}>
                      <Show when={dirty()} fallback={<X size={13} />}><span class="size-2 rounded-full bg-neutral-500" /></Show>
                    </button>
                  </div>
                );
              }}</For>
            </div>
            {tools()}
          </div>
          <div class="relative min-h-0 flex-1">
            <Suspense fallback={null}>
            <For each={panel().tabs}>{(tab) => (
              <div class="absolute inset-0 flex flex-col" classList={{ hidden: panel().active !== tab.id }}>
                <VisorDeArchivo
                  project={props.project}
                  session={props.session}
                  arbol={tab.tree}
                  ruta={tab.path}
                  cambiado={tab.changed}
                  enCambios={tab.changes}
                  visible={props.visible && panel().active === tab.id}
                  onSucio={(dirty) => props.files.setDirty(props.session, tab.id, dirty)}
                  onGuardador={() => {}}
                  onBorrado={() => props.files.removed(props.session, tab.tree, tab.path)}
                  onAbrirOtro={(path) => open(tab.tree, path, false, true)}
                  onGuardado={props.onSaved}
                />
              </div>
            )}</For>
            </Suspense>
          </div>
        </div>
      </Show>

        <aside class="flex min-h-0 flex-col"
          classList={{ hidden: !showTree(), "w-56 shrink-0 border-l border-border": showViewer(), "@4xl:w-64": showViewer(), "flex-1": !showViewer() }}>
          <div class="flex h-9 shrink-0 items-center gap-0.5 border-b border-border pl-1.5">
            <For each={["files", "changes"] as const}>{(side) => (
              <button type="button" onClick={() => props.files.setSide(props.session, side)}
                class={cn("flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-xs",
                  panel().side === side ? "bg-surface-muted font-semibold text-neutral-950" : "font-medium text-neutral-500 hover:bg-neutral-950/5 hover:text-neutral-950")}>
                {side === "files" ? t("code.panel.side.files") : t("code.panel.side.changes")}
              </button>
            )}</For>
            <Show when={!showViewer()}>{tools()}</Show>
          </div>
          <div class="min-h-0 flex-1" classList={{ hidden: panel().side !== "files" }}>
            <Suspense fallback={null}>
            <Codigo project={props.project} session={props.session} visible={props.visible && panel().side === "files"}
              onAbrir={(tree, path, changed) => open(tree, path, false, false, changed)}
              onAbrirFijo={(tree, path, changed) => open(tree, path, false, true, changed)}
              onMovido={props.onMoved} onBorrado={props.onRemoved} />
            </Suspense>
          </div>
          <Show when={panel().side === "changes"}>
            <Suspense fallback={null}>
            <ChangesList project={props.project} session={props.session} visible={props.visible}
              active={panel().tabs.find((tab) => tab.id === panel().active)}
              onOpen={(tree, path) => open(tree, path, true)} />
            </Suspense>
          </Show>
        </aside>
    </section>
  );
}

/** The compact list of what the task changed, one row per file; a click opens its diff. */
function ChangesList(props: {
  project: string;
  session: string;
  visible: boolean;
  active?: { tree: string; path: string; changes: boolean };
  onOpen: (tree: string, path: string) => void;
}) {
  const [rows, { refetch }] = createResource(() => [props.project, props.session] as const, async ([project, session]) => {
    const trees = await invoke<ArbolEnTarea[]>("list_task_trees", { project, session }, machineOf(session));
    const all = await Promise.all(trees.map(async (tree) => {
      const changes = await invoke<Cambios>("tree_changes", { project, session, tree: tree.key }, machineOf(session));
      return changes.files.map((file) => ({ ...file, tree: tree.key }));
    }));
    return all.flat();
  });
  alMoverseElArbol(() => props.session, () => props.visible, () => void refetch(), true);
  return (
    <div class="min-h-0 flex-1 overflow-y-auto py-1">
      <div class="px-3 pt-1 pb-2 text-[0.6875rem] text-neutral-500">{t("code.panel.changes.pending")}</div>
      <Show when={(rows.latest ?? []).length > 0} fallback={<div class="px-3 text-xs text-neutral-500">{rows.loading ? "" : t("code.panel.changes.none")}</div>}>
        <For each={rows.latest}>{(file) => {
          const on = () => props.active?.changes && props.active.tree === file.tree && props.active.path === file.path;
          const mark = () => file.status.charAt(0).toUpperCase();
          return (
            <button type="button" onClick={() => props.onOpen(file.tree, file.path)}
              class={cn("flex w-full items-center gap-1.5 py-1 pr-3 pl-3 text-left text-[0.75rem] hover:bg-surface-muted", on() && "bg-surface-muted")}>
              <IconoDeArchivo ruta={file.path} class="shrink-0 text-neutral-500" />
              <span class="min-w-0 flex-1 truncate font-mono">
                <span class="font-semibold">{nameOf(file.path)}</span>
                <Show when={folderOf(file.path)}><span class="pl-1.5 text-neutral-500">{folderOf(file.path)}</span></Show>
              </span>
              <span class="shrink-0 font-mono text-[0.6875rem]">
                <span class="text-success-strong">+{file.added}</span>
                <Show when={file.removed > 0}><span class="text-error-strong"> −{file.removed}</span></Show>
              </span>
              <span class={cn("w-2.5 shrink-0 text-right font-mono text-[0.625rem] font-semibold", MARK[mark()] ?? "text-neutral-500")}>{mark()}</span>
            </button>
          );
        }}</For>
      </Show>
    </div>
  );
}

