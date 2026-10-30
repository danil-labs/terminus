import { TEXT } from "@terminus/design";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { failureText } from "../lib/engine";
import type { Host } from "../lib/hosts";
import { t, w } from "../lib/i18n";
import { createSpace, type DeletePreview, deleteSpace, spaceDeletePreview } from "../lib/pending";
import { Sheet, SheetOption } from "./Sheet";
import { useTheme } from "./theme";

type Target = { host: Host; workspace: string };

/**
 * Nuevo espacio, desde el menú del título. Solo se abre si el teléfono puede
 * mandar `create_space` (`ready("spaces")`). El espacio nace en la primera
 * máquina del workspace, como al crear una tarea.
 */
export function NewSpaceSheet({ target, onClose, onCreated }: { target: Target | null; onClose: () => void; onCreated: (id: string) => void }) {
  const theme = useTheme();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => { if (busy) return; setName(""); setError(null); onClose(); };
  const create = async () => {
    const clean = name.trim();
    if (!target || !clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const space = await createSpace(target.host, target.workspace, clean);
      setName("");
      onCreated(space.id);
      onClose();
    } catch (cause) {
      setError(failureText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={!!target} title={w("spaces.new.title")} onClose={close}>
      <View style={styles.body}>
        <TextInput
          testID="new-space-name"
          autoFocus
          value={name}
          onChangeText={setName}
          onSubmitEditing={() => void create()}
          placeholder={t("space.name_placeholder")}
          placeholderTextColor={theme.textMuted}
          returnKeyType="done"
          style={[styles.input, { color: theme.text, backgroundColor: theme.muted }]}
        />
        {error ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{error}</Text> : null}
        <SheetOption label={t("space.create")} icon="plus" disabled={!name.trim() || busy} onPress={() => void create()} />
      </View>
    </Sheet>
  );
}

/**
 * Eliminar…: primero la previa del motor (`space_delete_preview`), que dice
 * qué tareas se archivan y qué se descarta; se confirma con eso mismo y, si el
 * motor ve algo distinto, se enseña la previa nueva en lugar de borrar.
 */
export function DeleteSpaceSheet({ target, space, onClose, onDeleted }: { target: Target | null; space: { id: string; name: string } | null; onClose: () => void; onDeleted: () => void }) {
  const theme = useTheme();
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = !!target && !!space;
  const [asked, setAsked] = useState<string | null>(null);
  if (open && asked !== space.id && !busy) {
    setAsked(space.id);
    setBusy(true);
    void spaceDeletePreview(target.host, target.workspace, space.id)
      .then(setPreview, (cause) => setError(failureText(cause)))
      .finally(() => setBusy(false));
  }
  const close = () => { if (busy) return; setPreview(null); setError(null); setAsked(null); onClose(); };
  const confirm = async () => {
    if (!target || !preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await deleteSpace(target.host, target.workspace, preview);
      if (outcome.deleted) { setPreview(null); setAsked(null); onDeleted(); onClose(); }
      else if (outcome.changed) setPreview(outcome.changed);
    } catch (cause) {
      setError(failureText(cause));
    } finally {
      setBusy(false);
    }
  };
  const dirty = preview?.tasks.filter((task) => task.files.length > 0).length ?? 0;
  return (
    <Sheet visible={open} title={space ? t("space.delete_title", { name: space.name }) : ""} onClose={close}>
      <View style={styles.body}>
        {preview?.last ? <Text style={{ color: theme.textMuted }}>{t("space.delete_last")}</Text> : preview ? (
          <>
            <Text style={{ color: theme.text, fontSize: TEXT.lead, lineHeight: 21 }}>{preview.tasks.length ? t("space.delete_body", { count: preview.tasks.length }) : t("space.delete_empty")}</Text>
            {dirty ? <Text style={{ color: theme.error }}>{t("space.delete_dirty", { count: dirty })}</Text> : null}
          </>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={{ color: theme.error }}>{error}</Text> : null}
        {preview && !preview.last ? <SheetOption label={w("spaces.menu.delete").replace("…", "")} icon="trash-2" destructive disabled={busy} onPress={() => void confirm()} /> : null}
        <SheetOption label={t("task.header.cancel")} disabled={busy} onPress={close} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 12, paddingBottom: 8 },
  input: { fontSize: 17, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
});
