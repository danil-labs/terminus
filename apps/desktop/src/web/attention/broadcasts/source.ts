import type { BroadcastSource } from '../../../../../../packages/attention/src/broadcast-panel.ts';
import type { InboxSession } from '../../../../../../packages/attention/src/inbox.ts';
import { createSupportAccess } from '../../../../../../packages/attention/src/support-access.ts';
import { resolveWorkspaceAccount } from '../../../../../../packages/attention/src/workspace-account.ts';
import { activeAccountOf } from '../../audit-log';

/** La web: por la entrada alfa y con la cuenta del workspace activo. Otro cliente trae su propia fuente. */
export const webBroadcastSource = (session: BroadcastSource['session'] & InboxSession, workspace: () => string | null): BroadcastSource => {
  const prefix = `${import.meta.env.BASE_URL}alpha-api`;
  return {
    session, request: (input, init) => fetch(input, init), prefix,
    writes: import.meta.env.TERMINUS_BROADCAST_WRITES === true, delivery: import.meta.env.TERMINUS_BROADCAST_DELIVERY === true, demo: false,
    account: async () => (await resolveWorkspaceAccount(workspace(), {
      accounts: createSupportAccess(session, fetch, prefix).memberships,
      active: async () => activeAccountOf(await session.getToken()),
    }))?.id ?? null,
  };
};
