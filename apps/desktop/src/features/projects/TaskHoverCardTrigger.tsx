import { createSignal, createUniqueId, type JSX, lazy, onCleanup, Suspense } from "solid-js";
import { Popover, PopoverContent } from "../../ui/Popover";
import { threadTitle } from "./Sessions";
import type { TaskHoverCardProps } from "./TaskHoverCard";

export const TASK_HOVER_CARD_DELAY = 400;
const CLOSE_DELAY = 150;

// El cuerpo de la tarjeta no entra en la carga inicial: solo hace falta al pasar por una fila.
const TaskHoverCard = lazy(() => import("./TaskHoverCard").then((m) => ({ default: m.TaskHoverCard })));

/**
 * Envuelve la fila de una tarea y saca su tarjeta a la derecha tras una pausa
 * del puntero o al llegar con el teclado. Solo escucha: no cancela ningún evento
 * de la fila, así que el clic, el menú y el arrastre siguen siendo suyos.
 */
export function WithTaskHoverCard(props: TaskHoverCardProps & {
  children: JSX.Element;
  class?: string;
  disabled?: boolean;
  placement?: "left-start" | "right-start";
}) {
  let fila: HTMLDivElement | undefined;
  let tarjeta: HTMLDivElement | undefined;
  let abrir: ReturnType<typeof setTimeout> | undefined;
  let cerrar: ReturnType<typeof setTimeout> | undefined;
  let descrito: Element | null = null;
  const id = createUniqueId();
  const [open, setOpen] = createSignal(false);

  const describir = (el: Element | null) => {
    descrito?.removeAttribute("aria-describedby");
    descrito = el;
    descrito?.setAttribute("aria-describedby", id);
  };
  const ocultar = () => {
    clearTimeout(abrir);
    clearTimeout(cerrar);
    describir(null);
    setOpen(false);
  };
  const programar = (destino: Element | null) => {
    if (props.disabled) return;
    clearTimeout(cerrar);
    if (open()) return;
    clearTimeout(abrir);
    abrir = setTimeout(() => {
      describir(destino);
      setOpen(true);
    }, TASK_HOVER_CARD_DELAY);
  };
  const soltar = () => {
    clearTimeout(abrir);
    clearTimeout(cerrar);
    cerrar = setTimeout(ocultar, CLOSE_DELAY);
  };
  onCleanup(ocultar);

  // El portal de Solid hace burbujear los eventos delegados de la tarjeta hasta aquí.
  const deLaFila = (e: Event) => !!fila?.contains(e.target as Node);
  const dentro = (el: EventTarget | null) =>
    !!el && (!!fila?.contains(el as Node) || !!tarjeta?.contains(el as Node));
  const aislar = (e: Event) => e.stopPropagation();

  const accion = (fn: () => void) => () => {
    ocultar();
    fn();
  };

  return (
    <div
      ref={fila}
      class={props.class}
      onPointerEnter={(e) => { if (e.pointerType !== "touch") programar(null); }}
      onPointerLeave={soltar}
      onPointerDown={(e) => { if (deLaFila(e)) ocultar(); }}
      onFocusIn={(e) => {
        const el = e.target as Element;
        if (deLaFila(e) && el.matches?.(":focus-visible")) programar(el);
      }}
      onFocusOut={(e) => { if (!dentro(e.relatedTarget)) soltar(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && open()) ocultar(); }}
    >
      {props.children}
      <Popover
        open={open()}
        onOpenChange={(next) => { if (!next) ocultar(); }}
        anchorRef={() => fila}
        placement={props.placement ?? "right-start"}
        gutter={8}
      >
        <PopoverContent
          id={id}
          aria-label={threadTitle(props.task)}
          class="w-64 border-border-strong p-2.5"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={() => clearTimeout(cerrar)}
          onPointerLeave={soltar}
        >
          <div
            ref={tarjeta}
            onClick={aislar}
            onDblClick={aislar}
            onContextMenu={aislar}
            onPointerDown={aislar}
            onMouseDown={aislar}
            onFocusOut={(e) => { aislar(e); if (!dentro(e.relatedTarget)) soltar(); }}
            onFocusIn={aislar}
          >
            <Suspense>
            <TaskHoverCard
              {...props}
              onOpen={accion(() => props.onOpen())}
              onPin={accion(() => props.onPin())}
              onArchive={accion(() => props.onArchive())}
            />
            </Suspense>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
