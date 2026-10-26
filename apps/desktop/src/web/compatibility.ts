/** Whether a computer's engine speaks the contract this build was made with. */

declare const __TERMINUS_CONTRACT__: string;

export type Compatibility = "ok" | "outdated" | "unknown";

// El segundo contrato solo añade chat_visual_part; conserva las llamadas
// existentes byte por byte. No se admite ningún otro contrato por semejanza.
const VISUAL_PARTS = [
  "d4541d178c64a065c1a4a0c693817eb84ad17052fd605815295fa1696955ef8f",
  "3972c281dba1b61f9ad06fc82fbf059af3dbc55770b0a1bcb59ce786ec0a56f1",
];

export function machineContracts(own: string = __TERMINUS_CONTRACT__): string[] {
  const normalized = own.trim().toLowerCase();
  return VISUAL_PARTS.includes(normalized) ? [...VISUAL_PARTS] : normalized ? [normalized] : [];
}

/** `contract` as `GET /v1/computers` gives it: the engine's last hello, or `null` if it never said. */
export function machineCompatibility(contract: string | null | undefined, own: string = __TERMINUS_CONTRACT__): Compatibility {
  const theirs = typeof contract === "string" ? contract.trim().toLowerCase() : "";
  if (!theirs || !own) return "unknown";
  return machineContracts(own).includes(theirs) ? "ok" : "outdated";
}
