import { Show, type JSX } from "solid-js";
import { MarcaAgente } from "../../ui/icons";
import type { Requirement } from "./environment-store";
import { t } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Badge } from "../../ui/Badge";

/**
 * Un renglón del reporte del entorno: si está o no, qué es, y qué hacer.
 *
 * Lo pintan dos pantallas que contestan la misma pregunta con la misma fuente
 * (`check_environment`): `Setup.tsx` al empezar y `Environment.tsx` cuando algo
 * se rompe después. Comparten el tronco —marca, nombre, si es obligatorio,
 * detalle— y lo que cambia va por parámetro:
 *
 * - `detalle`: en Estado del entorno lleva delante de quién es y cuánto ocupa.
 * - `remedio`: solo donde la app no puede traerlo; con un botón al lado, la
 *   instrucción de terminal es ruido.
 * - `etiqueta`: en Estado del entorno siempre que algo falte; en la preparación
 *   solo cuando la fila falló — mientras la app la trae, no informa de nada.
 * - `etiquetas`: de dónde salió lo que hay puesto, solo en Estado del entorno.
 * - `children`: los botones de instalar y de quitar la copia que sobra, donde
 *   hay dónde pulsarlos.
 */
export function RequirementRow(props: {
  r: Requirement;
  /** Sustituye a `r.detail`. Sin él se pinta el detalle tal cual. */
  detalle?: JSX.Element;
  /** Si se ofrece el comando para copiar a mano. */
  remedio?: boolean;
  /** Si se dice que lo que falta bloquea o no. */
  etiqueta?: boolean;
  /** Lo que va al lado del nombre, además de lo anterior. */
  etiquetas?: JSX.Element;
  children?: JSX.Element;
}) {
  const remedio = () => props.remedio ?? true;
  const etiqueta = () => props.etiqueta ?? true;

  return (
    <li
      class={cn(
        "flex gap-2.5 rounded-md border border-border bg-surface-muted p-2.5",
        props.r.ok && "border-transparent bg-transparent",
      )}
    >
      <span class={cn("font-mono text-neutral-500", props.r.ok && "text-success-strong")}>
        {props.r.ok ? "✓" : "○"}
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-[0.8125rem]">
          {/* Su marca, para reconocerlo sin leer. Git y los que no tienen una
              utilizable dejan el hueco: un símbolo inventado afirmaría de quién
              es algo que no sabemos (`ui/icons.tsx`). */}
          <MarcaAgente id={props.r.id} size={15} />
          <strong>{props.r.label}</strong>
          {/* Que algo falte no dice lo mismo según si bloquea o no. Solo cuando
              falta: sobre lo que ya está, la etiqueta no informa de nada. */}
          <Show when={!props.r.ok && etiqueta()}>
            <Badge tone={props.r.required ? "danger" : "neutral"}>
              {props.r.required
                ? t("settings.requirement.required")
                : t("settings.requirement.optional")}
            </Badge>
          </Show>
          {props.etiquetas}
        </div>
        <div class="mt-0.5 break-words text-xs text-neutral-500">
          {props.detalle ?? props.r.detail}
        </div>
        {/* El remedio es un comando: se muestra copiable, no como instrucción en
            prosa que haya que traducir a la terminal. */}
        <Show when={remedio() && props.r.remedy}>
          <code class="mt-1.5 block select-all overflow-x-auto rounded-sm border border-border bg-surface-raised px-2 py-1.5 font-mono text-[0.6875rem]">
            {props.r.remedy}
          </code>
        </Show>
        {props.children}
      </div>
    </li>
  );
}
