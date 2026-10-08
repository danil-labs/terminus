import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compone clases resolviendo conflictos: la última gana. Sin esto,
 * `<Button class="px-4">` no le gana al `px-2` del átomo: quedan las dos
 * clases y decide el orden del CSS, no el de la llamada.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
