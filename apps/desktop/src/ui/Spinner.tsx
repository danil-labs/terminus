import { cn } from "../lib/utils";

/** El loader: una pista tenue y un arco que gira en 20 pasos por segundo. */
export function Spinner(props: { size?: number; class?: string; label?: string }) {
  const size = () => props.size ?? 16;
  return (
    <svg
      class={cn("block shrink-0 animate-spin-fluido motion-reduce:animate-none", props.class)}
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={size() > 24 ? 2 : 2.6}
      stroke-linecap="round"
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    >
      <circle cx="12" cy="12" r="9.5" opacity="0.18" />
      <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5" />
    </svg>
  );
}
