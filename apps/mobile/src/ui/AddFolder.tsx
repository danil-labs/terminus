import type { Project, ProjectCloneEvent } from "@terminus/protocol";
import * as Crypto from "expo-crypto";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { cancelClone, cloneRepo, createFolder, projectDirectoryOf } from "../lib/engine";
import { type Host, HostError } from "../lib/hosts";
import { phrase, t, w } from "../lib/i18n";
import { Sheet } from "./Sheet";
import { useTheme } from "./theme";

/** Qué hoja está abierta: carpeta vacía o clonar un repositorio. */
export type AddFolderMode = "new-folder" | "clone";

const PHASES = {
  counting: "clone.counting",
  compressing: "clone.compressing",
  receiving: "clone.receiving",
  resolving: "clone.resolving",
  checkout: "clone.checkout",
} as const;

/** Lo que dice el motor de un clon fallido: su frase, salvo cancelar, que no es un error. */
function failureText(error: unknown, host: Host): string | null {
  if (error instanceof HostError && error.code === "machine_asleep") return w("web.machines.off_action", { name: host.label });
  if (error instanceof HostError && error.code === "machine_outdated") return w("web.machines.outdated_action", { name: host.label });
  if (error instanceof HostError && (error.code === "start_failed" || error.code === "start_timeout")) return t("machines.start_failed", { name: host.label });
  const detail = error instanceof HostError ? error.detail : error;
  if (detail === "clone_lost") return t("clone.lost");
  const failure = typeof detail === "object" && detail ? (detail as { what?: Parameters<typeof phrase>[0] }) : null;
  if (failure?.what && typeof failure.what === "object" && failure.what.clave === "projects.error.clone_cancelled") return null;
  if (failure?.what) return phrase(failure.what);
  return t("task.error", { detail: error instanceof Error ? error.message : String(error) });
}

/**
 * «Nueva carpeta» y «Clonar repo» de la tarea nueva, en la máquina elegida: la
 * carpeta queda en su carpeta de proyectos. El clon sigue en la máquina si se
 * cierra la hoja; cancelar lo detiene.
 */
export function AddFolderSheets({
  mode,
  host,
  workspace,
  space,
  onClose,
  onDone,
}: {
  mode: AddFolderMode | null;
  host: Host | undefined;
  /** El id del workspace en esa máquina. */
  workspace: string | null;
  space: string | null;
  onClose: () => void;
  onDone: (project: Project) => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [directory, setDirectory] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProjectCloneEvent | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const operation = useRef<string | null>(null);

  useEffect(() => {
    setDirectory(null);
    if (!mode || !host || !workspace || host.power() !== "on") return;
    let alive = true;
    void projectDirectoryOf(host, workspace).then((dir) => alive && setDirectory(dir));
    return () => {
      alive = false;
    };
  }, [mode, host, workspace]);

  const reset = () => {
    setName("");
    setUrl("");
    setNote(null);
    setProgress(null);
  };

  async function create() {
    if (!host || !workspace || !name.trim()) return;
    setBusy(true);
    setNote(null);
    try {
      const project = await createFolder(host, workspace, name.trim(), space);
      reset();
      onDone(project);
    } catch (error) {
      setNote(failureText(error, host));
    } finally {
      setBusy(false);
    }
  }

  async function clone() {
    if (!host || !workspace || !url.trim() || operation.current) return;
    const id = Crypto.randomUUID();
    operation.current = id;
    setBusy(true);
    setNote(null);
    setProgress(null);
    try {
      const project = await cloneRepo(host, workspace, { operation: id, url: url.trim(), name: name.trim(), space }, (event) => {
        if (operation.current === id) setProgress(event);
      });
      reset();
      onDone(project);
    } catch (error) {
      if (operation.current === id) setNote(failureText(error, host));
    } finally {
      if (operation.current === id) operation.current = null;
      setProgress(null);
      setBusy(false);
    }
  }

  function cancel() {
    const id = operation.current;
    if (!host || !workspace || !id) return;
    void cancelClone(host, workspace, id).catch((error) => setNote(failureText(error, host)));
  }

  const input = [styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }];
  const phase = progress ? t(PHASES[progress.phase as keyof typeof PHASES] ?? "clone.waiting") : null;
  const where = directory ? t("folder.where", { name: host?.label ?? "", path: directory }) : null;
  const button = (label: string, onPress: () => void, disabled: boolean, testID: string, primary = true) => (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary ? { backgroundColor: theme.primary } : { borderColor: theme.border, borderWidth: 1 }, { opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[styles.buttonText, { color: primary ? theme.onPrimary : theme.text }]}>{label}</Text>
    </Pressable>
  );

  return (
    <>
      <Sheet visible={mode === "new-folder"} title={t("folder.new")} onClose={onClose}>
        <View style={styles.body}>
          <TextInput
            testID="new-folder-name"
            style={input}
            value={name}
            onChangeText={setName}
            placeholder={t("folder.name")}
            placeholderTextColor={theme.textMuted}
            autoFocus
            editable={!busy}
            onSubmitEditing={() => void create()}
          />
          {where ? <Text style={[styles.hint, { color: theme.textMuted }]}>{where}</Text> : null}
          {note ? <Text style={[styles.hint, { color: theme.textMuted }]}>{note}</Text> : null}
          {button(t("folder.create"), () => void create(), busy || !name.trim() || !host, "new-folder-create")}
        </View>
      </Sheet>
      <Sheet visible={mode === "clone"} title={t("clone.title")} onClose={onClose}>
        <View style={styles.body}>
          <TextInput
            testID="clone-url"
            style={input}
            value={url}
            onChangeText={setUrl}
            placeholder="https://github.com/organizacion/repo"
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            autoFocus
            editable={!busy}
          />
          <TextInput
            testID="clone-name"
            style={input}
            value={name}
            onChangeText={setName}
            placeholder={t("clone.name")}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            editable={!busy}
          />
          {where ? <Text style={[styles.hint, { color: theme.textMuted }]}>{where}</Text> : null}
          {phase ? (
            <Text testID="clone-progress" style={[styles.hint, { color: theme.textMuted }]}>
              {progress?.percent != null ? t("clone.percent", { phase: phase ?? "", percent: progress.percent }) : phase}
            </Text>
          ) : null}
          {note ? <Text style={[styles.hint, { color: theme.textMuted }]}>{note}</Text> : null}
          {busy
            ? button(t("clone.cancel"), cancel, !progress, "clone-cancel", false)
            : button(t("clone.start"), () => void clone(), !url.trim() || !host, "clone-start")}
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 18, paddingVertical: 6, gap: 10 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  hint: { fontSize: 13, lineHeight: 18 },
  button: { borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
