import { BridgeError, type Pairing, type Receipt, call } from "./bridge";

type Created = Receipt & { result: (Receipt["result"] & { task_id?: string }) | null };

/** `task create` from the phone. Returns the new task even when its first turn failed. */
export async function startTask(
  pairing: Pairing,
  scope: { workspace: string; folder: string },
  args: { message: string; agent?: string; model?: string; handler?: string; space?: string },
) {
  const receipt = await call<Created>(pairing, "task create", args, scope);
  const task = receipt.result?.task_id;
  if (!task) throw new BridgeError(receipt.error?.code ?? "operation_failed", receipt.error?.detail);
  return task;
}
