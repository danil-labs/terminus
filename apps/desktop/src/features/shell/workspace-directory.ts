import { barWorkspaceIds, type DirectoryEntry } from "@terminus/computers";
import { createResource, createRoot, createSignal } from "solid-js";
import { capabilities } from "../../lib/platform";

/** El workspace que solo tiene agentes abierto desde el menú; `null` con uno de Terminus. */
export const [agentsWorkspace, setAgentsWorkspace] = createSignal<string | null>(null);

// Una sola lista para el menú y la barra. `capabilities()` no es reactivo: se crea al primer uso, ya con la plataforma puesta.
function createStore() {
  const [loaded, { refetch, mutate }] = createResource(
    () => capabilities().workspaceDirectory,
    (source) => source.list(),
  );
  return { loaded, refetch, mutate };
}
let created: ReturnType<typeof createStore> | undefined;
const store = () => (created ??= createRoot(createStore));

/** `undefined` mientras carga, y sin directorio en el escritorio. */
export const directory = () => (store().loaded.error ? undefined : store().loaded());
export const reloadDirectory = () => void store().refetch();

const entries = (): readonly DirectoryEntry[] => directory()?.workspaces ?? [];

/** Lo que la barra deja ver; `null` si muestra todos. */
export const workspaceBar = (active: string | null) => barWorkspaceIds(entries(), active);

/** Fijar o quitar; la lista se relee si el plano de control lo rechaza. */
export async function togglePin(entry: DirectoryEntry): Promise<void> {
  const source = capabilities().workspaceDirectory;
  const current = directory();
  if (!source || !current || entry.support) return;
  const pinned = current.workspaces.filter((e) => e.pin !== null).sort((a, b) => (a.pin ?? 0) - (b.pin ?? 0)).map((e) => e.key);
  const keys = entry.pin === null ? [...pinned, entry.key] : pinned.filter((key) => key !== entry.key);
  store().mutate({
    ...current,
    workspaces: current.workspaces.map((e) => ({ ...e, pin: keys.includes(e.key) ? keys.indexOf(e.key) : null })),
  });
  await source.pin(keys).catch(() => undefined);
  reloadDirectory();
}
