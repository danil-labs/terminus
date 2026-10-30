import { type DirectoryEntry, listDirectory } from '@terminus/computers';
import type { InboxSession } from '../../../../../packages/attention/src/inbox.ts';
import { type AccountSources, enterWorkspace } from '../../../../../packages/attention/src/workspace-account.ts';
import { activeAccountOf } from '../audit-log';

/** La sesión de las pantallas de agentes: quién es, qué puede entrar y el workspace con que habla al BFF. */
export type AgentsSession = InboxSession & {
  directory: () => Promise<DirectoryEntry[]>;
  rememberWorkspace: (key: string | null) => void;
};

const prefix = () => `${import.meta.env.BASE_URL}alpha-api`;

export function agentsSession(endpoint: string, session: InboxSession): AgentsSession {
  let key: string | null = null;
  return {
    ...session,
    workspaceKey: () => key,
    rememberWorkspace: value => { key = value; },
    reenter: async () => {
      if (!key) return false;
      return enterWorkspace(session, fetch, prefix(), key).then(() => true, () => false);
    },
    directory: async () => {
      const answer = await listDirectory(endpoint, await session.getToken());
      if (answer.kind !== 'ok') throw new Error('directory_unavailable');
      return answer.value.workspaces;
    },
  };
}

export const accountSources = (session: AgentsSession): AccountSources => ({
  directory: session.directory,
  active: async () => activeAccountOf(await session.getToken()),
  enter: key => enterWorkspace(session, fetch, prefix(), key),
  remember: session.rememberWorkspace,
});
