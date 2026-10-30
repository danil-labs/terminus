import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { t } from '../../../lib/i18n';

export type Query<T> = { data: () => T | undefined; error: () => string; loading: () => boolean; refresh: () => Promise<void> };

/** Una lectura viva: descarta respuestas viejas, se repite según `poll` y al volver a la ventana. */
export function createQuery<T>(load: () => Promise<T>, options: { key?: () => unknown; enabled?: () => boolean; poll?: (value: T | undefined) => number | false; focus?: boolean } = {}): Query<T> {
  const [data, setData] = createSignal<T>();
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  let epoch = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const enabled = () => options.enabled?.() ?? true;
  async function refresh() {
    clearTimeout(timer);
    if (!enabled()) return;
    const request = ++epoch;
    setLoading(true);
    try {
      const value = await load();
      if (request !== epoch) return;
      setData(() => value);
      setError('');
    } catch (cause) {
      if (request === epoch) setError(cause instanceof Error ? cause.message : t("web.alpha.error"));
    } finally {
      if (request === epoch) {
        setLoading(false);
        const delay = options.poll?.(data());
        if (delay) timer = setTimeout(() => void refresh(), delay);
      }
    }
  }
  createEffect(on(() => [options.key?.(), enabled()], () => { epoch++; clearTimeout(timer); setData(undefined); setError(''); setLoading(false); void refresh(); }));
  if (options.focus) {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    onCleanup(() => window.removeEventListener('focus', onFocus));
  }
  onCleanup(() => { epoch++; clearTimeout(timer); });
  return { data, error, loading, refresh };
}
