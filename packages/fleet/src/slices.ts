/**
 * Lo que contestó cada máquina a cada lectura: una rebanada con su estado.
 *
 * - `ok`: lo acaba de contestar.
 * - `cached`: una copia con su hora (del relay con la máquina apagada, o la
 *   última que se leyó aquí).
 * - `no_answer`: no contestó a tiempo; se queda lo que había.
 * - `off`: apagada y sin copia: no aporta nada, y nada se inventa en su lugar.
 * - `outdated`: su motor habla otro contrato.
 * - `license_required`: la cuenta no tiene Terminus de pago; se queda lo que había.
 *
 * Una rebanada sin valor (`has: false`) no aporta filas: nunca es una lista vacía.
 */

export type SliceStatus = "ok" | "cached" | "no_answer" | "off" | "outdated" | "license_required";

export type Slice = {
  machine: string;
  status: SliceStatus;
  /** Si `value` es una respuesta de la máquina; sin ella la rebanada no aporta nada. */
  has: boolean;
  value: unknown;
  /** Cuándo se leyó `value` (ms de época), o `null`. */
  at: number | null;
  /** El error con nombre de la última vez, si falló. */
  error?: string;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Schedule = (run: () => void, ms: number) => unknown;
type Entry = { at: number; value: string };

const ENTRY = 200_000;
const TOTAL = 2_000_000;
export const SAVE_EVERY = 30_000;
export const SLICES_KEY = "terminus-fleet:slices:v1";

/**
 * Las rebanadas por máquina y lectura. Las que traen valor se guardan en el
 * almacenamiento de la página (acotadas, con espera) y al arrancar vuelven
 * como `cached` con su hora: sin red se ve lo último de cada máquina.
 */
export class SliceBook {
  private slices = new Map<string, Map<string, Slice>>();
  private saved = new Map<string, Entry>();
  private timer: unknown;
  private readonly storage: StorageLike | null;
  private readonly schedule: Schedule;

  constructor(storage: StorageLike | null = null, schedule: Schedule = (run, ms) => setTimeout(run, ms)) {
    this.storage = storage;
    this.schedule = schedule;
    try {
      const raw = storage?.getItem(SLICES_KEY);
      if (raw) this.saved = new Map(Object.entries(JSON.parse(raw) as Record<string, Entry>));
    } catch {}
  }

  get(machine: string, key: string): Slice | null {
    const live = this.slices.get(machine)?.get(key);
    if (live) return live;
    const entry = this.saved.get(storeKey(machine, key));
    if (!entry) return null;
    try {
      return { machine, status: "cached", has: true, value: JSON.parse(entry.value), at: entry.at };
    } catch {
      return null;
    }
  }

  put(slice: Slice, key: string) {
    const of = this.slices.get(slice.machine) ?? new Map<string, Slice>();
    // La más reciente al final: `statuses` lee la última.
    of.delete(key);
    of.set(key, slice);
    this.slices.set(slice.machine, of);
    if (!slice.has || (slice.status !== "ok" && slice.status !== "cached")) return;
    let text: string;
    try {
      text = JSON.stringify(slice.value ?? null);
    } catch {
      return;
    }
    const id = storeKey(slice.machine, key);
    if (this.saved.get(id)?.value === text) return;
    this.saved.delete(id);
    if (text.length <= ENTRY) this.saved.set(id, { at: slice.at ?? Date.now(), value: text });
    if (this.storage && this.timer === undefined) this.timer = this.schedule(() => this.flush(), SAVE_EVERY);
  }

  /** La máquina ya no es de la cuenta: nada suyo se queda, ni guardado. */
  forget(machine: string) {
    this.slices.delete(machine);
    for (const id of [...this.saved.keys()]) if (id.startsWith(`${machine}\u0000`)) this.saved.delete(id);
    this.flush();
  }

  /**
   * El estado de cada máquina: el de su lectura más reciente, salvo que esa no
   * sea de ahora ni diga otro contrato o licencia y haya algo guardado: entonces
   * `cached` con la hora de la copia más nueva. Una lectura sin copia no tapa las que sí la tienen.
   */
  statuses(): Record<string, { status: SliceStatus; at: number | null }> {
    const out: Record<string, { status: SliceStatus; at: number | null }> = {};
    for (const [machine, of] of this.slices) {
      const all = [...of.values()];
      const last = all.at(-1);
      if (!last) continue;
      const saved = all.filter((s) => s.has && s.status !== "ok" && s.at !== null);
      const settled = last.status === "ok" || last.status === "outdated" || last.status === "license_required";
      out[machine] = !settled && saved.length ? { status: "cached", at: Math.max(...saved.map((s) => s.at as number)) } : { status: last.status, at: last.at };
    }
    return out;
  }

  flush() {
    if (this.timer !== undefined) clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    this.timer = undefined;
    if (!this.storage) return;
    let size = 0;
    const kept = [...this.saved].reverse().filter(([, entry]) => (size += entry.value.length) <= TOTAL);
    this.saved = new Map(kept.reverse());
    try {
      this.storage.setItem(SLICES_KEY, JSON.stringify(Object.fromEntries(this.saved)));
    } catch {}
  }
}

const storeKey = (machine: string, key: string) => `${machine}\u0000${key}`;
