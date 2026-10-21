/**
 * Si el motor de una computadora habla el contrato con el que se hizo un
 * cliente: `contract` es el hash que dio su último `hello` (`GET /v1/computers`)
 * y `own`, el de `commands.json` del cliente. La regla de
 * `apps/desktop/src/web/compatibility.ts`.
 */
export type Compatibility = "ok" | "outdated" | "unknown";

export function machineCompatibility(contract: string | null | undefined, own: string | null | undefined): Compatibility {
  const theirs = typeof contract === "string" ? contract.trim().toLowerCase() : "";
  const mine = typeof own === "string" ? own.trim().toLowerCase() : "";
  if (!theirs || !mine) return "unknown";
  return theirs === mine ? "ok" : "outdated";
}
