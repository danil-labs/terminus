import type { BroadcastSource } from '../../../../../../packages/attention/src/broadcast-panel.ts';
import { activeAccountOf } from '../../audit-log';

/** La web: por la entrada alfa y con la cuenta activa del JWT. Otro cliente trae su propia fuente. */
export const webBroadcastSource = (session: BroadcastSource['session']): BroadcastSource => ({
  session, request: (input, init) => fetch(input, init), prefix: `${import.meta.env.BASE_URL}alpha-api`,
  writes: import.meta.env.TERMINUS_BROADCAST_WRITES === true, demo: false,
  account: async () => activeAccountOf(await session.getToken()),
});
