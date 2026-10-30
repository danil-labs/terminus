const query = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
const nested = new URLSearchParams((query.get('to') ?? '').split('?')[1] ?? '');
export const ALPHA_DEMO = process.env.EXPO_PUBLIC_TERMINUS_ALPHA === '1' && (query.get('demo') === '1' || nested.get('demo') === '1');
export const ALPHA_ORDINARY = query.get('ordinary') === '1';
export const alphaMemory = new Map<string, string>();
export const demoDenied = () => new Error('demo_read_only');
/** La base de la web que fijó la compilación (`web-mobile.mjs`); sin ella, la de siempre. Los enlaces nuevos se derivan de aquí. */
export const WEB_BASE = process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE || '/terminus/';
/** El proxy de la entrada alfa, bajo la base de la web (`<base>alpha-api`). */
export const ALPHA_API = `${WEB_BASE}alpha-api`;
