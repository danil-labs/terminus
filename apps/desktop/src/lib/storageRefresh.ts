export function storageRefresh<T>(options: {
  read: (refresh: boolean) => Promise<T>;
  receive: (value: T) => void;
  fail: (error: unknown) => void;
  measuring: (active: boolean) => void;
}) {
  let running: Promise<void> | null = null;
  let pending: boolean | null = null;
  let generation = 0;
  let disposed = false;

  function refresh(fresh = true): Promise<void> {
    if (disposed) return Promise.resolve();
    pending = pending === true || fresh;
    if (running) return running;
    running = (async () => {
      options.measuring(true);
      try {
        while (pending !== null && !disposed) {
          const measure = pending;
          const current = generation;
          pending = null;
          try {
            const value = await options.read(measure);
            if (!disposed && current === generation) options.receive(value);
          } catch (error) {
            if (!disposed && current === generation) options.fail(error);
          }
        }
      } finally {
        running = null;
        if (!disposed) options.measuring(false);
      }
    })();
    return running;
  }

  return {
    refresh,
    reset() {
      generation++;
      return refresh();
    },
    dispose() {
      disposed = true;
      generation++;
      pending = null;
    },
  };
}
