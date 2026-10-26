/**
 * Si el motor de una computadora habla el contrato con el que se hizo un
 * cliente: `contract` es el hash que dio su último `hello` (`GET /v1/computers`)
 * y `own`, el de `commands.json` del cliente.
 */
export type Compatibility = "ok" | "outdated" | "unknown";

// El segundo contrato solo añade chat_visual_part; conserva las llamadas
// existentes byte por byte. No se admite ningún otro contrato por semejanza.
const VISUAL_PARTS = [
  "d4541d178c64a065c1a4a0c693817eb84ad17052fd605815295fa1696955ef8f",
  "3972c281dba1b61f9ad06fc82fbf059af3dbc55770b0a1bcb59ce786ec0a56f1",
];

export function machineContracts(own: string | null | undefined): string[] {
  const normalized = typeof own === "string" ? own.trim().toLowerCase() : "";
  return VISUAL_PARTS.includes(normalized) ? [...VISUAL_PARTS] : normalized ? [normalized] : [];
}

export function machineCompatibility(contract: string | null | undefined, own: string | null | undefined): Compatibility {
  const theirs = typeof contract === "string" ? contract.trim().toLowerCase() : "";
  const mine = typeof own === "string" ? own.trim().toLowerCase() : "";
  if (!theirs || !mine) return "unknown";
  return machineContracts(mine).includes(theirs) ? "ok" : "outdated";
}
