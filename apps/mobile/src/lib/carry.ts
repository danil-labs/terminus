/**
 * Llevar el trabajo de una carpeta a la máquina donde nace la tarea nueva, por
 * el relay (`@terminus/carry`). El teléfono hace de puente entre los dos motores,
 * siempre sellado para el destino y solo al crear una tarea: nunca trae nada.
 * Sin React Native: lo recorre `computers:smoke` en Node.
 */
import {
  type CarryEngine,
  type CarryProgress,
  type Exported,
  type Imported,
  type Part,
  type WorkStatus,
  PART_RELAY,
  carryWork,
  hasWork,
  initialSelection,
  keyVerdict,
  newState,
  withoutRemote,
} from "@terminus/carry";
import { cloneRepo, type Folder } from "./engine";
import { HostError, type Host } from "./hosts";

/** Cada máquina con el id de este workspace en ella: cada motor tiene el suyo. */
export type Place = { host: Host; workspace: string };

export function carryEngine(place: (machine: string) => Place): CarryEngine {
  const call = async <T>(machine: string, command: Parameters<Host["call"]>[0], args: object) => {
    const { host, workspace } = place(machine);
    return (await host.call<T>(command, workspace, args)).value;
  };
  return {
    status: (m, args) => call<WorkStatus>(m, "work_status", args),
    exportWork: (m, args) => call<Exported>(m, "work_export", args),
    readPart: (m, args) => call<Part>(m, "work_read_part", args),
    writePart: (m, args) => call(m, "work_write_part", args),
    importWork: (m, args) => call<Imported>(m, "work_import", args),
    cancel: (m, args) => call(m, "work_cancel", args),
    key: (m) => call<{ publicKey: string }>(m, "work_key", {}),
  };
}

/** Las llaves fijadas por máquina (TOFU), donde el teléfono las guarde. */
export type KeyPins = { get(machine: string): Promise<string | null>; set(machine: string, key: string): Promise<void> };

/**
 * Antes de crear la tarea en `target` con la carpeta de `source`: lleva los
 * commits sin subir, los cambios y los `.env` sugeridos, sellados para el
 * destino. `null` es que no hay nada que llevar. Una llave que cambió no lleva
 * nada (`key_changed`): eso lo decide la persona en el escritorio o la web.
 */
export async function carryForNewTask(
  args: { source: Place; target: Place; folder: Folder; targetHasFolder: boolean; pins: KeyPins; newId: () => string; onProgress?: (p: CarryProgress) => void },
): Promise<{ baseRef: string; unwrapSnapshot: boolean } | null> {
  const ids = { [args.source.host.id]: args.source, [args.target.host.id]: args.target };
  const engine = carryEngine((m) => ids[m]);
  const source = args.source.host.id;
  const target = args.target.host.id;
  const status = await engine.status(source, { project: args.folder.id, task: null });
  if (args.targetHasFolder && !hasWork(status)) return null;
  const key = (await engine.key(target)).publicKey;
  const verdict = keyVerdict(await args.pins.get(target), key);
  if (verdict === "changed") throw new HostError("key_changed", target);
  if (verdict === "new") await args.pins.set(target, key);
  const noRemote = withoutRemote(status, args.folder.remote_url);
  const create = noRemote && !args.targetHasFolder ? { name: args.folder.name, id: args.folder.id } : null;
  const selection = initialSelection(status);
  const url = status.remoteUrl ?? args.folder.remote_url;
  const result = await carryWork(
    engine,
    { source, target, project: args.folder.id, task: null, selection: create ? { ...selection, includeWork: true, full: true } : selection, partSize: PART_RELAY, recipientKey: key, create },
    newState(args.newId()),
    {
      progress: args.onProgress,
      hasProject: async () => args.targetHasFolder,
      clone: create || !url ? undefined : async () => {
        await cloneRepo(args.target.host, args.target.workspace, { operation: args.newId(), url, name: args.folder.name, space: null, id: args.folder.id }, () => {});
      },
    },
  );
  return result.baseRef ? { baseRef: result.baseRef, unwrapSnapshot: result.unwrapSnapshot } : null;
}

