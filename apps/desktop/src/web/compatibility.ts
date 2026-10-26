/** Los contratos que esta compilación del navegador sabe hablar. */
import { machineCompatibility as compatibility, machineContracts as contracts, type Compatibility } from "@terminus/computers";

declare const __TERMINUS_CONTRACT__: string;

export function machineContracts(own: string = __TERMINUS_CONTRACT__): string[] {
  return contracts(own);
}

export function machineCompatibility(contract: string | null | undefined, own: string = __TERMINUS_CONTRACT__): Compatibility {
  return compatibility(contract, own);
}
