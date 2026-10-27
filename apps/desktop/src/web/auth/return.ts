/** Return destinations stay inside this Terminus installation. */
export function authDestination(value: string | null, origin: string, base: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x1f]/.test(value)) return base;
  try {
    const url = new URL(value, origin);
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== origin || !path.startsWith(base) || path.startsWith(`${base}auth`) || /[\\\x00-\x1f]/.test(path)) return base;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return base;
  }
}

export function authLocation(login: string, origin: string, destination: string): string {
  const url = new URL(login, origin);
  url.searchParams.set("next", destination);
  return url.toString();
}
