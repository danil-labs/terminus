/** Whether a computer's engine speaks the contract this build was made with. */

declare const __TERMINUS_CONTRACT__: string;

export type Compatibility = "ok" | "outdated" | "unknown";

/** `contract` as `GET /v1/computers` gives it: the engine's last hello, or `null` if it never said. */
export function machineCompatibility(contract: string | null | undefined, own: string = __TERMINUS_CONTRACT__): Compatibility {
  const theirs = typeof contract === "string" ? contract.trim().toLowerCase() : "";
  if (!theirs || !own) return "unknown";
  return theirs === own.toLowerCase() ? "ok" : "outdated";
}
