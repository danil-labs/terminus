const query = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
const nested = new URLSearchParams((query.get('to') ?? '').split('?')[1] ?? '');
export const ALPHA_DEMO = process.env.EXPO_PUBLIC_TERMINUS_ALPHA === '1' && (query.get('demo') === '1' || nested.get('demo') === '1');
export const ALPHA_ORDINARY = query.get('ordinary') === '1';
export const alphaMemory = new Map<string, string>();
export const demoDenied = () => new Error('demo_read_only');
/** El proxy de la entrada alfa, bajo la base de la web (`<base>alpha-api`). */
export const ALPHA_API = `${process.env.EXPO_PUBLIC_TERMINUS_WEB_BASE || '/terminus/'}alpha-api`;
