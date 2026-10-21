export type VisualBudget = { claim: () => (() => void) | null };

// Cada reserva cubre un HTML de hasta 512 KiB, antes de iniciar su lectura.
export function createVisualBudget(): VisualBudget {
  let reserved = 0;
  return {
    claim() {
      if (reserved >= 16) return null;
      reserved += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        reserved -= 1;
      };
    },
  };
}
