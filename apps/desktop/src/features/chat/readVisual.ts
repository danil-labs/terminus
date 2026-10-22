import { invoke } from "../../lib/invoke";
import { t } from "../../lib/i18n";
import { MAX_VISUAL_BYTES, VISUAL_FILE, VISUAL_TREE } from "@terminus/chat/visual";

type Scope = { workspace: string; project: string; session: string };
type Content = { kind: string; text: string; bytes: number; truncated: boolean };

export async function readChatVisual(scope: Scope, file: string): Promise<string> {
  if (!scope.workspace || !scope.session || file.length > 128 || !VISUAL_FILE.test(file)) {
    throw { what: t("chat.visual.invalid"), detail: "invalid_visual_file" };
  }
  try {
    const content = await invoke<Content>("tree_show", {
      project: scope.project, session: scope.session, tree: VISUAL_TREE, path: file,
    }, { headers: { "x-terminus-workspace": scope.workspace } });
    if (content.truncated || content.bytes > MAX_VISUAL_BYTES) {
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

/** Abre el HTML del visual en el navegador, con el mismo ámbito que su lectura. */
export async function openChatVisual(scope: Scope, file: string): Promise<void> {
  if (!scope.workspace || !scope.session || file.length > 128 || !VISUAL_FILE.test(file)) {
    throw { what: t("chat.visual.invalid"), detail: "invalid_visual_file" };
  }
  await invoke("tree_open_external", {
    project: scope.project, session: scope.session, tree: VISUAL_TREE, path: file,
  }, { headers: { "x-terminus-workspace": scope.workspace } });
}
