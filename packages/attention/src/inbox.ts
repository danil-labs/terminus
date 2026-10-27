export type Account = { id: number; name: string };
export type Conversation = { id: number; account_id: number; contact_name: string; channel_name: string; last_message: string; ai_assistance: boolean; unread_count: number };
export type Message = { id: number; conversation_id: number; content: string | null; direction: 'inbound' | 'outbound'; sender_type: string; deleted_at?: string | null };
export type Page<T> = { rows: T[]; hasMore: boolean };
export type InboxSession = { getToken(): Promise<string>; unauthorized(): Promise<boolean> };

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
  return value as Record<string, unknown>;
};
const number = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('invalid_response');
  return value;
};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('invalid_response');
  return value;
};

/** Only same-origin, read-only BFF routes; account IDs never imply Terminus workspace IDs. */
export function createInbox(session: InboxSession, request: typeof fetch = fetch, prefix = "/terminus/alpha-api") {
  async function get(path: string) {
    let response = await request(`${prefix}${path}`, { headers: { Authorization: `Bearer ${await session.getToken()}` }, cache: 'no-store' });
    if (response.status === 401 && await session.unauthorized()) response = await request(`${prefix}${path}`, { headers: { Authorization: `Bearer ${await session.getToken()}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return object(await response.json());
  }
  return {
    async accounts(): Promise<Account[]> {
      const data = object((await get('/auth/profile')).user);
      return array(data.accounts ?? []).map(value => {
        const row = object(value);
        return { id: number(row.id), name: text(row.name) };
      });
    },
    async conversations(account: number, offset = 0): Promise<Page<Conversation>> {
      const id = number(account);
      const data = await get(`/api/inbox/conversations?account_id=${id}&limit=30&offset=${Math.max(0, Math.floor(offset))}`);
      if (typeof data.hasMore !== 'boolean') throw new Error('invalid_response');
      return { hasMore: data.hasMore, rows: array(data.conversations).map(value => {
        const row = object(value);
        if (row.account_id !== id || typeof row.ai_assistance !== 'boolean') throw new Error('invalid_scope');
        return { id: number(row.id), account_id: id, contact_name: text(row.contact_name), channel_name: text(row.channel_name), last_message: text(row.last_message), ai_assistance: row.ai_assistance, unread_count: typeof row.unread_count === 'number' ? row.unread_count : 0 };
      }) };
    },
    async messages(account: number, conversation: number, before?: number): Promise<Page<Message>> {
      const id = number(conversation);
      const data = await get(`/api/inbox/conversations/${id}/messages?account_id=${number(account)}&limit=50${before ? `&before_id=${number(before)}` : ''}`);
      if (typeof data.hasMore !== 'boolean') throw new Error('invalid_response');
      return { hasMore: data.hasMore, rows: array(data.messages).map(value => {
        const row = object(value);
        if (row.conversation_id !== id || !['inbound', 'outbound'].includes(String(row.direction))) throw new Error('invalid_scope');
        return { id: number(row.id), conversation_id: id, content: row.content == null ? null : text(row.content), direction: row.direction as Message['direction'], sender_type: text(row.sender_type), deleted_at: row.deleted_at == null ? null : text(row.deleted_at) };
      }) };
    },
  };
}
