/**
 * El arranque en dos tiempos: la lista ligera abre la ventana y
 * `workspaces_startup` la confirma.
 *
 * `workspaces_startup` corre las migraciones dentro y puede tardar minutos;
 * `list_workspaces` contesta en segundos (es lo que usa cambiar de workspace).
 * La ventana aplica la lista en cuanto llega y, cuando llega el arranque,
 * decide aquí si lo que pintó sigue valiendo.
 *
 * Lo que no se negocia: `bloqueo` (`workspaces::base_decidida`) solo lo trae el
 * arranque. Llegue cuando llegue, tapa la app aunque la lista ya se haya
 * aplicado; eso lo hace quien llama, antes de mirar `reconciliar`.
 */

type Forma = {
  workspaces: { id: string }[];
  active: string | null;
  migrations?: unknown[];
  bloqueo?: unknown;
};

/**
 * Si la lista ligera basta para abrir la ventana antes del arranque.
 *
 * Solo con un workspace activo que esté en la lista. Sin activo, `aplicar`
 * abre el alta de «primer arranque», y eso es justo lo que no se puede
 * adelantar: puede ser una instalación que el arranque va a rechazar
 * (`bloqueo` llega con la lista vacía) o una que una migración todavía no
 * ha traído. Ese caso espera al arranque, como antes.
 */
export function listaBasta(lista: Forma): boolean {
  if (lista.bloqueo) return false;
  if (lista.active === null) return false;
  return lista.workspaces.some((w) => w.id === lista.active);
}

/**
 * Qué hacer cuando llega `workspaces_startup` habiendo aplicado ya `previa`
 * (o nada, `null`).
 *
 * - `"aplicar"`: no se aplicó nada, o lo aplicado ya no vale — otro activo,
 *   otros workspaces o corrió una migración que la lista no había visto (los
 *   datos cambiaron debajo de lo pintado).
 * - `"nada"`: es lo mismo que ya está en pantalla. Re-aplicar cerraría la tarea
 *   que la persona ya abrió.
 */
export function reconciliar(previa: Forma | null, arranque: Forma): "aplicar" | "nada" {
  if (!previa) return "aplicar";
  if (previa.active !== arranque.active) return "aplicar";
  const antes = previa.workspaces.map((w) => w.id).sort().join("\n");
  const ahora = arranque.workspaces.map((w) => w.id).sort().join("\n");
  if (antes !== ahora) return "aplicar";
  if ((previa.migrations?.length ?? 0) !== (arranque.migrations?.length ?? 0)) return "aplicar";
  return "nada";
}
