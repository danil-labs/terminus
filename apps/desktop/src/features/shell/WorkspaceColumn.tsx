import Plus from "lucide-solid/icons/plus";
import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { t } from "../../lib/i18n";
import { createNavigationReorder } from "../../lib/navigation-order";
import { KeyedList } from "../../ui/KeyedList";
import { cn } from "../../lib/utils";
import { capabilities, type OtherAccount, type OtherWorkspace } from "../../lib/platform";
import { generacionDeLogo, urlDeLogo } from "./logo-src";
import { ITEM_DE_MENU, Popover, PopoverAnchor, PopoverContent } from "../../ui/Popover";
import { RETARDO_TOOLTIP, TooltipContent, TooltipRoot, TooltipTrigger } from "../../ui/Tooltip";
import { stateColor, stateIcon, taskLabel } from "../projects/TaskStatus";
import { cerrarConEscape, createWorkspaces, type Workspace } from "../settings/workspaces-store";
import { topState, type AttentionState, type WorkspaceAttention } from "./attention";

/** Las iniciales de las dos primeras palabras; una sola palabra da una letra. */
export function monogram(name: string) {
  const words = name.trim().split(/[\s\-_.]+/).filter(Boolean);
  return words.slice(0, 2).map((word) => [...word][0] ?? "").join("").toUpperCase() || "?";
}

/** El logo del workspace, o sus iniciales si no hay imagen o todavía no carga. */
/** `id`: en la web, el logo de un workspace de la cuenta sale de la cuenta (`urlDeLogo`). */
export function MarcaDeWorkspace(props: { id?: string; name: string; logo?: string | null; load?: () => Promise<string | null> }) {
  const [url, setUrl] = createSignal<string | null>(null);
  createEffect(() => {
    // Un workspace de otra cuenta trae su propio lector, con el token de su cuenta.
    if (props.load) {
      let vivo = true;
      onCleanup(() => {
        vivo = false;
      });
      void props.load().then((siguiente) => {
        if (vivo) setUrl(siguiente);
      }, () => undefined);
      return;
    }
    const path = props.logo ?? null;
    const workspace = props.id ?? null;
    const gen = generacionDeLogo();
    if (!path && !workspace) {
      setUrl(null);
      return;
    }
    let vivo = true;
    onCleanup(() => {
      vivo = false;
    });
    void urlDeLogo(path, workspace).then((siguiente) => {
      if (vivo && generacionDeLogo() === gen) setUrl(siguiente);
    });
  });
  return (
    <Show when={url()} fallback={<>{monogram(props.name)}</>}>
      {(src) => <img src={src()} alt="" draggable={false} class="absolute inset-0 size-full object-cover" />}
    </Show>
  );
}

/**
 * Lo más urgente de un workspace, en un disco. La pregunta va en amarillo con el
 * glifo navy: el amarillo como glifo sobre la superficie no llega a 3:1.
 */
export function AttentionBadge(props: { state: AttentionState; class?: string }) {
  return (
    <span
      data-attention-badge={props.state}
      class={cn(
        "grid size-4 shrink-0 place-items-center rounded-full border",
        props.state === "asked"
          ? "border-border-strong bg-brand-yellow text-brand-navy"
          : cn("border-border bg-surface", stateColor(props.state)),
        props.class,
      )}
    >
      <Dynamic component={stateIcon(props.state)} size={11} />
    </span>
  );
}

/** Cambiar de workspace con un clic y ver, sin entrar, qué espera en cada uno. */
export default function WorkspaceColumn(props: {
  attention: WorkspaceAttention[];
  onManage: () => void;
}) {
  const ws = createWorkspaces();
  let list: HTMLDivElement | undefined;
  const reorder = createNavigationReorder({
    scope: () => ws.activo() ?? "",
    list: () => list,
    attribute: "data-workspace-tile",
    axis: "y",
    ids: () => (ws.lista() ?? []).map(w => w.id),
    save: ws.reorder,
  });
  const [menuOf, setMenuOf] = createSignal<string | null>(null);
  cerrarConEscape(() => menuOf() !== null, () => setMenuOf(null));

  const stateOf = (id: string) =>
    topState(props.attention.find((w) => w.workspace === id)?.tasks ?? []);

  const Tile = (p: { w: Workspace }) => {
    const active = () => p.w.id === ws.activo();
    const state = () => stateOf(p.w.id);
    const label = () => {
      const s = state();
      return s
        ? t("shell.workspaces.tile_with_state", { name: p.w.name, state: taskLabel(s, true) })
        : p.w.name;
    };
    let anchor: HTMLButtonElement | undefined;
    return (
      <Popover
        open={menuOf() === p.w.id}
        onOpenChange={(open) => setMenuOf(open ? p.w.id : null)}
        placement="right-start"
        gutter={4}
      >
        <PopoverAnchor class="w-full">
          {/* El monograma no basta para distinguir dos workspaces; `title` casi no se ve en el webview. */}
          <TooltipRoot openDelay={RETARDO_TOOLTIP} placement="right" gutter={6} disabled={menuOf() === p.w.id || reorder.source() !== null}>
          <TooltipTrigger
            as="button"
            ref={anchor}
            type="button"
            data-workspace-tile={p.w.id}
            data-attention={state() ?? undefined}
            class={cn("marca-seleccion group relative grid h-12 w-full shrink-0 touch-none place-items-center outline-none select-none", reorder.source() === p.w.id && "cursor-grabbing opacity-40")}
            aria-current={active() ? "true" : undefined}
            aria-label={label()}
            onPointerDown={(e: PointerEvent) => reorder.start(p.w.id, e)}
            onClick={() => void ws.cambiarA(p.w.id)}
            onContextMenu={(e: MouseEvent) => {
              e.preventDefault();
              setMenuOf(p.w.id);
            }}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                e.preventDefault();
                setMenuOf(p.w.id);
              }
            }}
          >
            <Show when={reorder.edge(p.w.id)}>
              {(edge) => <span aria-hidden="true" class={cn("pointer-events-none absolute right-2 left-2 h-0.5 bg-primary", edge() === "before" ? "top-0" : "bottom-0")} />}
            </Show>
            <span
              aria-hidden="true"
              class={cn(
                "relative grid size-10 place-items-center rounded-lg border text-[0.875rem] font-semibold group-focus-visible:outline-solid group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary",
                active()
                  ? "border-border-strong bg-surface-raised text-neutral-950"
                  : "border-border bg-surface text-neutral-700 group-hover:bg-neutral-200 group-hover:text-neutral-950",
              )}
            >
              <span class="absolute inset-0 overflow-hidden rounded-[inherit]">
                <span class="relative grid size-full place-items-center">
                  <MarcaDeWorkspace id={p.w.id} name={p.w.name} logo={p.w.logo} />
                </span>
              </span>
              <Show when={state()}>
                {(s) => <AttentionBadge state={s()} class="absolute -top-1.5 -right-1.5" />}
              </Show>
            </span>
          </TooltipTrigger>
          {/* Solo el nombre: el estado ya lo dice el distintivo, y repetirlo en
              palabras estorbaba. `aria-label` sí lo lleva, que no ve el distintivo. */}
          <TooltipContent>{p.w.name}</TooltipContent>
          </TooltipRoot>
        </PopoverAnchor>
        {/* Sin `Popover.Trigger` el foco no vuelve solo al cuadro. */}
        <PopoverContent
          role="menu"
          class="w-56 p-1"
          onCloseAutoFocus={(e: Event) => {
            e.preventDefault();
            anchor?.focus();
          }}
        >
          <p class="m-0 truncate px-2 pt-1 pb-1 text-[0.6875rem] font-medium text-neutral-500">{p.w.name}</p>
          <button
            role="menuitem"
            class={ITEM_DE_MENU}
            onClick={() => {
              setMenuOf(null);
              props.onManage();
            }}
          >
            {t("settings.workspaces.manage")}
          </button>
        </PopoverContent>
      </Popover>
    );
  };

  // Las otras cuentas de Danil de este navegador (solo la web): sus workspaces van debajo, por cuenta.
  const accounts = capabilities().webAccounts;
  const others = () => accounts?.others() ?? [];
  const [accountMenu, setAccountMenu] = createSignal<string | null>(null);
  cerrarConEscape(() => accountMenu() !== null, () => setAccountMenu(null));

  /** La cuenta de un grupo: la inicial de su correo; su menú la quita o vuelve a entrar. */
  const AccountHeader = (p: { id: string; email: string | null; extra: boolean; signedIn: boolean; stale?: boolean }) => {
    const label = () => t("shell.workspaces.account", { email: p.email ?? "" });
    return (
      <Popover open={accountMenu() === p.id} onOpenChange={(open) => setAccountMenu(open ? p.id : null)} placement="right-start" gutter={4}>
        <PopoverAnchor class="w-full">
          <TooltipRoot openDelay={RETARDO_TOOLTIP} placement="right" gutter={6} disabled={accountMenu() === p.id}>
            <TooltipTrigger
              as="button"
              type="button"
              data-account-header={p.id}
              class="mt-2 mb-0.5 flex w-full items-center gap-1 px-3 text-left outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-primary"
              aria-label={label()}
              onClick={() => setAccountMenu(p.id)}
            >
              <span aria-hidden="true" class="grid size-4 shrink-0 place-items-center rounded-full bg-neutral-200 text-[0.5625rem] font-semibold text-neutral-700">
                {monogram(p.email ?? "?").slice(0, 1)}
              </span>
              <span aria-hidden="true" class="h-px flex-1 bg-border" />
            </TooltipTrigger>
            <TooltipContent>{p.email}</TooltipContent>
          </TooltipRoot>
        </PopoverAnchor>
        <PopoverContent role="menu" class="w-64 p-1">
          <p class="m-0 truncate px-2 pt-1 pb-1 text-[0.6875rem] font-medium text-neutral-500">{p.email}</p>
          <Show when={p.stale && p.signedIn}>
            <p class="m-0 px-2 pb-1 text-[0.6875rem] text-neutral-500">{t("shell.workspaces.stale")}</p>
          </Show>
          <Show when={!p.signedIn}>
            <button role="menuitem" class={ITEM_DE_MENU} onClick={() => (setAccountMenu(null), accounts?.add(p.email))}>
              {t("shell.workspaces.sign_in_again")}
            </button>
          </Show>
          <Show when={p.extra}>
            <button
              role="menuitem"
              class={ITEM_DE_MENU}
              onClick={() => {
                setAccountMenu(null);
                if (window.confirm(t("shell.workspaces.remove_confirm", { email: p.email ?? "" }))) void accounts?.remove(p.id);
              }}
            >
              {t("shell.workspaces.remove_account")}
            </button>
          </Show>
        </PopoverContent>
      </Popover>
    );
  };

  /** Un workspace de otra cuenta: abrirlo recarga la página con esa cuenta; con la sesión caducada, pide volver a entrar. */
  const OtherTile = (p: { w: OtherWorkspace; account: OtherAccount }) => {
    const label = () => {
      const values = { name: p.w.name, email: p.account.email ?? "" };
      return p.account.signedIn ? t("shell.workspaces.other_tile", values) : t("shell.workspaces.expired_tile", values);
    };
    return (
      <TooltipRoot openDelay={RETARDO_TOOLTIP} placement="right" gutter={6}>
        <TooltipTrigger
          as="button"
          type="button"
          data-other-workspace-tile={p.w.id}
          class={cn("group relative grid h-12 w-full shrink-0 place-items-center outline-none select-none", !p.account.signedIn && "opacity-50")}
          aria-label={label()}
          onClick={() => (p.account.signedIn ? accounts?.open(p.w.id) : accounts?.add(p.account.email))}
        >
          <span
            aria-hidden="true"
            class="relative grid size-10 place-items-center rounded-lg border border-border bg-surface text-[0.875rem] font-semibold text-neutral-700 group-hover:bg-neutral-200 group-hover:text-neutral-950 group-focus-visible:outline-solid group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-primary"
          >
            <span class="absolute inset-0 overflow-hidden rounded-[inherit]">
              <span class="relative grid size-full place-items-center">
                <MarcaDeWorkspace name={p.w.name} load={p.w.logo} />
              </span>
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{label()}</TooltipContent>
      </TooltipRoot>
    );
  };

  // Con uno solo no hay a dónde cambiar: crear el segundo vive en el menú del nombre (`TitleBar.tsx`).
  // Cuenta también los de otras cuentas: una cuenta vacía no necesita columna.
  return (
    <Show when={(ws.lista()?.length ?? 0) + others().reduce((total, account) => total + account.workspaces.length, 0) > 1}>
    <nav
      aria-label={t("shell.workspaces.label")}
      data-workspace-column=""
      class="glass-panel flex h-full w-16 shrink-0 flex-col border-r border-border"
    >
      <div ref={list} class="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto pt-2 pb-2">
        <Show when={accounts && others().length > 0}>
          <AccountHeader id={accounts!.current.user_id} email={accounts!.current.email} extra={accounts!.current.extra} signedIn />
        </Show>
        <KeyedList each={ws.lista() ?? []} by={w => w.id}>{w => <Tile w={w()} />}</KeyedList>
        <button
          type="button"
          class="mt-1 grid size-10 shrink-0 place-items-center rounded-lg border border-dashed border-neutral-500 text-neutral-500 outline-none hover:bg-neutral-200 hover:text-neutral-950 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          aria-label={t("shell.workspaces.new")}
          title={t("shell.workspaces.new")}
          onClick={() => window.dispatchEvent(new CustomEvent("harness:new-workspace"))}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <For each={others()}>
          {(account) => (
            <>
              <AccountHeader id={account.user_id} email={account.email} extra={account.extra} signedIn={account.signedIn} stale={account.stale} />
              <For each={account.workspaces}>{(w) => <OtherTile w={w} account={account} />}</For>
            </>
          )}
        </For>
      </div>
    </nav>
    </Show>
  );
}
