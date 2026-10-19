/**
 * The last answer to each read, per computer, kept in the page's storage. With
 * the computer off the panel shows these instead of an error; they are never
 * used while it answers.
 */

const ENTRY = 200_000;
const TOTAL = 2_000_000;
const SAVE_AFTER = 1000;

type Entry = { at: number; value: string };

export class ReadCache {
  private entries = new Map<string, Entry>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly key: string;

  constructor(computerId: string) {
    this.key = `terminus-web:reads:${computerId}`;
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) this.entries = new Map(Object.entries(JSON.parse(raw) as Record<string, Entry>));
    } catch {}
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
    if (text.length > ENTRY) return void this.entries.delete(key);
    this.entries.delete(key);
    this.entries.set(key, { at: Date.now(), value: text });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), SAVE_AFTER);
  }

  private save() {
    let size = 0;
    const kept = [...this.entries].reverse().filter(([, entry]) => (size += entry.value.length) <= TOTAL);
    this.entries = new Map(kept.reverse());
    try {
      localStorage.setItem(this.key, JSON.stringify(Object.fromEntries(this.entries)));
    } catch {}
  }
}
