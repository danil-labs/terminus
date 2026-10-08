import { createSignal, onCleanup, Show } from "solid-js";
import { t } from "../../lib/i18n";
import { Popover, PopoverContent } from "../../ui/Popover";
import { RETARDO_TOOLTIP } from "../../ui/Tooltip";
import { MarcaAgente } from "../../ui/icons";
import { AstroAvatar } from "../projects/AstroAvatar";

/** Un input del hilo, con la identidad de quien lo envió si fue un agente. */
export type InputMessage = {
  block: number;
  text: string;
  sender?: { kind: "agent"; name: string } | { kind: "task"; agent: string; model?: string | null };
};

const TICK_PITCH = 11;
const RAIL_PADDING = 8;
const CLOSE_DELAY = 200;
const WHEEL_QUIET = 300;
const PREVIEW_LENGTH = 100;

export default function YourMessages(props: {
  messages: InputMessage[];
  active: number;
  visibleHeight: number;
  onJump: (block: number) => void;
  bodyOf?: (name: string) => string | null;
  avatarOf?: (name: string) => string | null;
}) {
  const [open, setOpen] = createSignal(false);
  const [preview, setPreview] = createSignal(props.active);
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWheel: number | null = null;
  let rail: HTMLButtonElement | undefined;
  let anchor: HTMLSpanElement | undefined;
  onCleanup(() => {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
  });

  const height = () => Math.min(Math.max(24, props.visibleHeight - 16), props.messages.length * TICK_PITCH + RAIL_PADDING * 2);
  const pitch = () => (height() - RAIL_PADDING * 2) / props.messages.length;
  const top = () => Math.max(0, Math.round((props.visibleHeight - height()) / 2));
  const tickTop = (index: number) => RAIL_PADDING + Math.max(0, Math.min(props.messages.length - 1, index)) * pitch();
  const current = () => props.messages[Math.min(preview(), props.messages.length - 1)];
  const excerpt = () => current()?.text.slice(0, PREVIEW_LENGTH) ?? "";
  const indexAt = (e: { clientY: number }) => {
    const y = e.clientY - (rail?.getBoundingClientRect().top ?? 0) - RAIL_PADDING;
    return Math.max(0, Math.min(props.messages.length - 1, Math.floor(y / pitch())));
  };
  const cancelOpen = () => {
    clearTimeout(openTimer);
    openTimer = undefined;
  };
  const show = () => {
    clearTimeout(closeTimer);
    if (open()) return;
    cancelOpen();
    openTimer = setTimeout(() => {
      openTimer = undefined;
      setOpen(true);
    }, RETARDO_TOOLTIP);
  };
  const leave = () => {
    lastWheel = null;
    cancelOpen();
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => setOpen(false), CLOSE_DELAY);
  };
  const wheel = () => {
    lastWheel = performance.now();
    cancelOpen();
    setOpen(false);
  };
  const movePointer = (e: PointerEvent) => {
    setPreview(indexAt(e));
    if (lastWheel !== null) {
      if ((!e.movementX && !e.movementY) || performance.now() - lastWheel < WHEEL_QUIET) return;
      lastWheel = null;
    }
    show();
  };
  const jump = () => {
    setOpen(false);
    if (current()) props.onJump(current().block);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    const next = e.key === "ArrowDown" ? Math.min(props.messages.length - 1, preview() + 1)
      : e.key === "ArrowUp" ? Math.max(0, preview() - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? props.messages.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    setPreview(next);
    setOpen(true);
  };

  return (
    <div class="pointer-events-none sticky top-0 z-10 -mt-3 h-3">
      <Popover open={open()} onOpenChange={(next) => { if (!next) setOpen(false); }} anchorRef={() => anchor} placement="right" gutter={8}>
        <button
          ref={rail}
          type="button"
          class="riel-de-mensajes pointer-events-auto absolute left-0 w-8 rounded-sm outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          style={{
            top: `${top()}px`,
            height: `${height()}px`,
            "--riel-paso": `${pitch()}px`,
            "--riel-grosor": `${Math.min(3, pitch() * 0.6)}px`,
            "--riel-activo": `${tickTop(props.active)}px`,
          }}
          aria-label={`${t("chat.rail.label")}: ${excerpt()}`}
          aria-haspopup="dialog"
          aria-expanded={open()}
          onPointerEnter={movePointer}
          onPointerMove={movePointer}
          onPointerLeave={leave}
          onWheel={wheel}
          onFocus={() => { setPreview(props.active); setOpen(true); }}
          onKeyDown={key}
          onClick={(e) => { if (e.detail !== 0) setPreview(indexAt(e)); jump(); }}
        />
        <span ref={anchor} class="pointer-events-none absolute left-4 size-px" style={{ top: `${top() + tickTop(preview())}px` }} aria-hidden="true" />
        <PopoverContent
          class="pointer-events-none w-64 p-2"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div class="flex items-start gap-2">
            <p class="m-0 min-w-0 flex-1 text-[0.8125rem] leading-[1.4] break-words line-clamp-2">{excerpt()}</p>
            <Show when={current()?.sender}>
              {(sender) => (
                <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-200">
                  <Show when={sender().kind === "agent" ? sender() as { kind: "agent"; name: string } : null}
                    fallback={<MarcaAgente id={(sender() as { kind: "task"; agent: string }).agent} size={14} />}>
                    {(agent) => <AstroAvatar name={agent().name} status="awake" body={props.bodyOf?.(agent().name)} avatar={props.avatarOf?.(agent().name)} size={24} />}
                  </Show>
                </span>
              )}
            </Show>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
