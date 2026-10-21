/**
 * The last answer to each read, per computer, kept in the page's storage. With
 * the computer off the panel shows these instead of an error; they are never
 * used while it answers.
 *
 * The window asks the same reads every few seconds and the whole copy is one
 * storage item of up to `TOTAL` characters: rewriting it on every answer grew
 * Safari's storage journal by gigabytes. So it is written only when an answer
 * changed, at most once per `SAVE_EVERY`, and once more when the page goes away.
 */

const ENTRY = 200_000;
const TOTAL = 2_000_000;
export const SAVE_EVERY = 30_000;

type Entry = { at: number; value: string };
type Schedule = (run: () => void, ms: number) => unknown;

export class ReadCache {
  private entries = new Map<string, Entry>();
  private timer: unknown;
  /** An answer changed since the last write. */
  private changed = false;
  /** Only the time of an answer changed: written when the page goes away, never on its own. */
  private touched = false;
  private readonly key: string;
  private readonly schedule: Schedule;

  constructor(computerId: string, schedule: Schedule = (run, ms) => setTimeout(run, ms)) {
    this.key = `terminus-web:reads:v2:${computerId}`;
    this.schedule = schedule;
    try {
      // v1 kept reads with the old wire names (`agent` for the CLI, `encargado`); drop it.
      localStorage.removeItem(`terminus-web:reads:${computerId}`);
      const raw = localStorage.getItem(this.key);
      if (raw) this.entries = new Map(Object.entries(JSON.parse(raw) as Record<string, Entry>));
    } catch {}
    if (typeof addEventListener === "function") addEventListener("pagehide", () => this.flush());
  }

  get(key: string): { value: unknown; at: number } | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    try {
      return { value: JSON.parse(entry.value), at: entry.at };
    } catch {
      return null;
    }
  }

  put(key: string, value: unknown) {
    let text: string;
    try {
      text = JSON.stringify(value ?? null);
    } catch {
      return;
    }
    const before = this.entries.get(key);
    this.entries.delete(key);
    if (text.length > ENTRY) {
      if (before) this.mark();
      return;
    }
    this.entries.set(key, { at: Date.now(), value: text });
    if (before?.value === text) this.touched = true;
    else this.mark();
  }

  /** Writes now whatever is pending. */
  flush() {
    if (this.timer !== undefined) return void this.save();
    if (this.touched) this.save();
  }

  private mark() {
    this.changed = true;
    if (this.timer === undefined) this.timer = this.schedule(() => this.save(), SAVE_EVERY);
  }

  private save() {
    if (this.timer !== undefined) clearTimeout(this.timer as ReturnType<typeof setTimeout>);
    this.timer = undefined;
    if (!this.changed && !this.touched) return;
    this.changed = this.touched = false;
    let size = 0;
    const kept = [...this.entries].reverse().filter(([, entry]) => (size += entry.value.length) <= TOTAL);
    this.entries = new Map(kept.reverse());
    try {
      localStorage.setItem(this.key, JSON.stringify(Object.fromEntries(this.entries)));
    } catch {}
  }
}
