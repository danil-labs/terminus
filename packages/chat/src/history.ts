/**
 * Which stretch of the whole transcript a client holds, and how pages join it.
 * `revision` hashes the whole saved task: a title or a new turn changes it, so it says
 * "the file changed", never "the transcript was rewritten". Continuity comes from the turns.
 */

/** The `history` field of a read: `turns[i]` is turn `start + i`. */
export type HistoryPage = { version?: number; revision?: string; total: number; start: number; end: number; limit: number; has_more: boolean };

export type LoadedHistory<T> = { revision?: string; start: number; total: number; turns: T[] };

export type HistoryRead<T> = { turns: T[]; history?: HistoryPage | null };

/** Set while someone reads away from the end: a new tail must not take the turns they are reading. */
export type RefreshOptions = { reading?: boolean };

const HISTORY_BYTES = 2 * 1024 * 1024;
const OLDER_ATTEMPTS = 3;

const endOf = (history: LoadedHistory<unknown>) => history.start + history.turns.length;

/** Newer turns exist that this window does not hold. */
export const hasRecentGap = (history: LoadedHistory<unknown>) => endOf(history) < history.total;

export const hasOlder = (history: LoadedHistory<unknown>) => history.start > 0;

/** The `before` that asks for the page ending in the first held turn: that one turn proves the join. */
export const olderCursor = (history: LoadedHistory<unknown>) => (history.turns.length ? history.start + 1 : history.start);

const turnId = (turn: unknown) => (typeof turn === "object" && turn !== null && "id" in turn ? (turn as { id?: unknown }).id : undefined);

function sameTurn(a: unknown, b: unknown) {
  const id = turnId(a);
  return id !== undefined && id !== null ? id === turnId(b) : JSON.stringify(a) === JSON.stringify(b);
}

const withRevision = (revision: string | undefined) => (revision ? { revision } : {});

const sizes = <T,>(turns: T[]) => turns.map(turn => new TextEncoder().encode(JSON.stringify(turn)).length);
const sum = (values: number[]) => values.reduce((all, value) => all + value, 0);

function bounded<T>(history: LoadedHistory<T>, version: number | undefined, edge: "head" | "tail"): LoadedHistory<T> {
  if (version !== 1) return history;
  const each = sizes(history.turns);
  let bytes = sum(each);
  let from = 0, end = each.length;
  while (bytes > HISTORY_BYTES && end - from > 1) {
    bytes -= edge === "tail" ? each[from++] : each[--end];
  }
  return from === 0 && end === each.length ? history : { ...history, start: history.start + from, turns: history.turns.slice(from, end) };
}

/**
 * A read of the end. Keeps what was loaded before unless the turns they share differ.
 * A window that left the tail behind stays where it is: it only learns the new total.
 */
export function refreshHistory<T>(previous: LoadedHistory<T> | undefined, turns: T[], page?: HistoryPage | null, options: RefreshOptions = {}): LoadedHistory<T> {
  if (!page) return { start: 0, total: turns.length, turns };
  const revision = withRevision(page.revision);
  const fresh = { ...revision, start: page.start, total: page.total, turns };
  if (!previous || page.total < previous.total) return bounded(fresh, page.version, "tail");
  const held = endOf(previous);
  const shared = Math.min(held, page.end) - Math.max(previous.start, page.start);
  for (let at = Math.max(previous.start, page.start), n = 0; n < shared; at++, n++) {
    if (!sameTurn(previous.turns[at - previous.start], turns[at - page.start])) return bounded(fresh, page.version, "tail");
  }
  const window = { ...previous, ...revision, total: page.total };
  if (page.start > held) return hasRecentGap(previous) || options.reading ? window : bounded(fresh, page.version, "tail");
  const start = Math.min(previous.start, page.start);
  const merged = { ...revision, start, total: page.total, turns: [...previous.turns.slice(0, Math.max(0, page.start - previous.start)), ...turns] };
  const fits = page.version !== 1 || sum(sizes(merged.turns)) <= HISTORY_BYTES;
  return !fits && (hasRecentGap(previous) || options.reading) ? window : bounded(merged, page.version, "tail");
}

/** An older page in front of what is loaded; `null` if it no longer joins and the tail must be read again. */
export function prependHistory<T>(previous: LoadedHistory<T>, turns: T[], page?: HistoryPage | null): LoadedHistory<T> | null {
  if (!page || !turns.length) return null;
  const overlap = page.end - previous.start;
  if (overlap < 0 || overlap > 1) return null;
  // Without a shared turn only an untouched file proves the join.
  if (overlap === 0 && (page.total < previous.total || (page.revision && page.revision !== previous.revision))) return null;
  if (overlap === 1 && !sameTurn(turns.at(-1), previous.turns[0])) return null;
  const older = overlap ? turns.slice(0, -1) : turns;
  return bounded({ ...withRevision(page.revision ?? previous.revision), start: page.start, total: previous.total, turns: [...older, ...previous.turns] }, page.version, "head");
}

export type OlderState = "idle" | "loading" | "failed";

export type HistoryPagerOptions<T> = {
  read: (before: number | null) => Promise<HistoryRead<T>>;
  /** Something a client paints changed: the window or the state of the older page. */
  onChange?: () => void;
};

/**
 * The window of one task and its older page: one request at a time, a tail that lands
 * while it travels does not cost the page, and a failure stays visible until a retry.
 */
export class HistoryPager<T> {
  loaded: LoadedHistory<T> | undefined;
  older: OlderState = "idle";
  private generation = 0;

  private readonly options: HistoryPagerOptions<T>;

  constructor(options: HistoryPagerOptions<T>) {
    this.options = options;
  }

  /** A read of the end, from wherever it came. */
  accept(turns: T[], page?: HistoryPage | null, refresh?: RefreshOptions): LoadedHistory<T> {
    this.loaded = refreshHistory(this.loaded, turns, page, refresh);
    this.options.onChange?.();
    return this.loaded;
  }

  /** Back to the end, on request: what was read stays until the tail arrives. */
  async latest(): Promise<LoadedHistory<T>> {
    const generation = ++this.generation;
    const read = await this.options.read(null);
    if (generation !== this.generation) return this.loaded ?? this.accept(read.turns, read.history);
    this.loaded = undefined;
    this.setOlder("idle");
    return this.accept(read.turns, read.history);
  }

  /**
   * Fetches the page before the window and returns how to put it in, so a list can hold what
   * is being read around it. `null`: nothing to do, a failure (see `older`) or a transcript
   * rewritten under the window, which goes back to the tail.
   */
  async fetchOlder(): Promise<(() => void) | null> {
    if (this.older === "loading" || !this.loaded || !hasOlder(this.loaded)) return null;
    const generation = this.generation;
    this.setOlder("loading");
    try {
      for (let attempt = 0; attempt < OLDER_ATTEMPTS; attempt++) {
        const asked = this.loaded;
        if (!asked || !hasOlder(asked)) break;
        const page = await this.options.read(olderCursor(asked));
        if (generation !== this.generation) return null;
        const current = this.loaded;
        if (!current || current.start !== asked.start) continue;
        const merged = prependHistory(current, page.turns, page.history);
        if (merged) {
          this.setOlder("idle");
          return () => {
            if (generation !== this.generation || this.loaded?.start !== asked.start) return;
            // The tail may have moved while the list made room: only the front is taken from the page.
            const front = merged.turns.slice(0, asked.start - merged.start);
            this.loaded = { ...merged, turns: [...front, ...this.loaded.turns] };
            this.loaded = bounded({ ...this.loaded, total: Math.max(this.loaded.total, merged.total) }, page.history?.version, "head");
            this.options.onChange?.();
          };
        }
        const read = await this.options.read(null);
        if (generation !== this.generation) return null;
        this.loaded = undefined;
        this.setOlder("idle");
        this.accept(read.turns, read.history);
        return null;
      }
      this.setOlder("idle");
      return null;
    } catch (error) {
      if (generation === this.generation) this.setOlder("failed");
      return null;
    }
  }

  /** Stop listening: an answer that arrives afterwards changes nothing. */
  close() {
    this.generation++;
    if (this.older !== "idle") this.setOlder("idle");
  }

  private setOlder(state: OlderState) {
    if (this.older === state) return;
    this.older = state;
    this.options.onChange?.();
  }
}
