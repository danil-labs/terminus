import type { InboxSession } from './inbox.ts';

/** Same-origin BFF call with the session token; a 401 refreshes the session and retries once. */
export function sessionFetch(session: InboxSession, request: typeof fetch) {
  return async (url: string, init: RequestInit = {}) => {
    const send = async () => request(url, { ...init, cache: 'no-store', headers: { ...init.headers, Authorization: `Bearer ${await session.getToken()}` } });
    const response = await send();
    return response.status === 401 && await session.unauthorized() ? send() : response;
  };
}
