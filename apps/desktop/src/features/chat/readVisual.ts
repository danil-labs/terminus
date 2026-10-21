import { invoke } from "../../lib/invoke";
import { t } from "../../lib/i18n";

type Scope = { workspace: string; project: string; session: string };
type Content = { kind: string; text: string; bytes: number; truncated: boolean };
const MAX_BYTES = 512 * 1024;

export async function readChatVisual(scope: Scope, file: string): Promise<string> {
  if (!scope.workspace || !scope.session || file.length > 128 || !/^[a-z0-9][a-z0-9._-]*\.html$/i.test(file)) {
    throw { what: t("chat.visual.invalid"), detail: "invalid_visual_file" };
  }
  try {
    const content = await invoke<Content>("tree_show", {
      project: scope.project, session: scope.session, tree: "terminus-chat-visuals", path: file,
    }, { headers: { "x-terminus-workspace": scope.workspace } });
    if (content.truncated || content.bytes > MAX_BYTES) {
      throw { what: t("chat.visual.too_large"), detail: "visual_too_large" };
    }
    if (content.kind !== "text" || typeof content.text !== "string" ||
      !Number.isFinite(content.bytes) || content.bytes < 0 ||
      new TextEncoder().encode(content.text).byteLength !== content.bytes) {
      throw { what: t("chat.visual.invalid"), detail: "invalid_visual_file" };
    }
    return content.text;
  } catch (error) {
    const detail = error && typeof error === "object" && "detail" in error ? error.detail : null;
    if (detail === "invalid_visual_file") throw { what: t("chat.visual.invalid"), detail };
    if (detail === "visual_too_large") throw { what: t("chat.visual.too_large"), detail };
    if (detail === "visual_read_failed") throw { what: t("chat.visual.failed"), detail };
    throw error;
  }
}
