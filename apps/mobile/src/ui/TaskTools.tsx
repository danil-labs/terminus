import { RADIUS, TEXT } from "@terminus/design";
import { usageTone, windowLabel, windowLeft } from "@terminus/computers";
import type { AccountLimits, UsageWindow } from "@terminus/protocol";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { type ProviderUsage, providerUsage } from "../lib/accountUsage";
import { accountWorkspace } from "../lib/engine";
import type { Folder } from "../lib/engine";
import type { Host } from "../lib/hosts";
import { lang, t, w } from "../lib/i18n";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icon";
import { Tap } from "./list";
import { measure, type Rect } from "./Popover";
import { FolderIcon } from "./FolderIcon";
import { type Theme, useTheme } from "./theme";

const windowsOf = (limits: AccountLimits | null | undefined): UsageWindow[] =>
  limits?.mode === "read" ? limits.windows : limits?.mode === "waiting" ? limits.last?.windows ?? [] : [];

const toneColor = (theme: Theme, left: number) => {
  const tone = usageTone(left);
  return tone === "error" ? theme.failedMark : tone === "warning" ? theme.approving : theme.success;
};

/**
 * Bajo el título del chat: dónde corre la tarea (máquina / carpeta / rama) y
 * sus herramientas: buscar en el chat, los archivos de la tarea, las subtareas (con su número, solo si hay), y la
 * barra de uso de la cuenta del proveedor, que abre su detalle. Leer el uso
 * nunca enciende la máquina.
 */
export function TaskTools({
  host,
  workspace,
  machine,
  folder,
  branch,
  provider,
  subtasks,
  finding,
  onFind,
  onTools,
  onFiles,
}: {
  host: Host | undefined;
  workspace: string;
  machine: string;
  folder: Folder | null;
  branch: string | null;
  provider: string | null;
  subtasks: number;
  finding: string | null;
  onFind: (query: string | null) => void;
  onTools: () => void;
  onFiles: () => void;
}) {
  const theme = useTheme();
  const [usage, setUsage] = useState<ProviderUsage | null>(null);
  const [revision, setRevision] = useState(0);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const bar = useRef(null);
  const on = host?.power() === "on";

  useEffect(() => {
    if (!host || !provider || !on) return;
    let live = true;
    void providerUsage([host], provider, (h) => accountWorkspace(h, workspace)).then((value) => { if (live) setUsage(value); }, () => {});
    return () => { live = false; };
  }, [host, workspace, provider, on, revision]);

  const windows = usage ? usage.groups.flatMap((group) => windowsOf(usage.limits[group.key])) : [];
  const tightest = windows.length ? Math.min(...windows.map(windowLeft)) : null;

  return (
    <View style={[styles.wrap, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <View style={styles.row}>
        <View style={styles.place}>
          <Icon name="laptop" size={14} color={theme.textMuted} />
          <Text numberOfLines={1} style={[styles.placeText, { color: theme.textMuted, maxWidth: 90, flexShrink: 2 }]}>{machine}</Text>
          {folder ? (
            <>
              <Text style={{ color: theme.textMuted }}>/</Text>
              <FolderIcon folder={folder} size={13} />
              <Text numberOfLines={1} style={[styles.placeText, { color: theme.text, maxWidth: 100, flexShrink: 0 }]}>{folder.name}</Text>
            </>
          ) : null}
          {branch ? (
            <>
              <Text style={{ color: theme.textMuted }}>/</Text>
              <Icon name="git-branch" size={12} color={theme.textMuted} />
              <Text numberOfLines={1} style={[styles.placeText, { color: theme.text, flexShrink: 1 }]}>{branch}</Text>
            </>
          ) : null}
        </View>
        <Tap testID="chat-find" accessibilityRole="button" accessibilityLabel={t("task.tools.find")} accessibilityState={{ selected: finding !== null }} onPress={() => onFind(finding === null ? "" : null)} style={styles.tool}>
          <Icon name="search" size={16} color={finding !== null && !theme.dark ? theme.merged : theme.text} strokeWidth={finding !== null ? 2.6 : 2} />
        </Tap>
        <Tap testID="chat-tree" accessibilityRole="button" accessibilityLabel={t("task.tools.files")} onPress={onFiles} style={styles.tool}>
          <Icon name="list-tree" size={16} color={theme.text} />
        </Tap>
        {subtasks ? (
          <Tap testID="chat-subtasks" accessibilityRole="button" accessibilityLabel={t("task.tools.subtasks", { count: subtasks })} onPress={onTools} style={styles.tool}>
            <Icon name="git-fork" size={16} color={theme.text} />
            <Text style={{ color: theme.text, fontSize: TEXT.ui, fontWeight: "600" }}>{subtasks}</Text>
          </Tap>
        ) : null}
        {tightest !== null ? (
          <View ref={bar} collapsable={false}>
            <Tap testID="chat-usage" accessibilityRole="button" accessibilityLabel={t("task.tools.usage", { left: tightest })} onPress={() => void measure(bar).then(setAnchor)} style={styles.tool}>
              <View style={[styles.track, { backgroundColor: theme.border }]}>
                <View style={[styles.fill, { width: `${100 - tightest}%`, backgroundColor: toneColor(theme, tightest) }]} />
              </View>
            </Tap>
          </View>
        ) : null}
      </View>
      {finding !== null ? (
        <View style={[styles.find, { backgroundColor: theme.muted }]}>
          <Icon name="search" size={14} color={theme.textMuted} />
          <TextInput testID="chat-find-input" autoFocus value={finding} onChangeText={onFind} placeholder={t("task.tools.find_placeholder")} placeholderTextColor={theme.textMuted} autoCorrect={false} autoCapitalize="none" style={[styles.findInput, { color: theme.text }]} />
          <Tap accessibilityRole="button" accessibilityLabel={t("search.clear")} onPress={() => onFind(null)} style={styles.close}>
            <Icon name="x" size={14} color={theme.textMuted} />
          </Tap>
        </View>
      ) : null}

      <Modal visible={!!anchor} transparent animationType="fade" onRequestClose={() => setAnchor(null)}>
        <Pressable accessibilityRole="button" onPress={() => setAnchor(null)} style={[StyleSheet.absoluteFill, { backgroundColor: theme.dark ? "rgba(0,0,0,0.4)" : "rgba(10,13,35,0.18)" }]} />
        {anchor && usage ? (
          <View testID="usage-popover" style={[styles.popover, { top: anchor.y + anchor.height + 8, backgroundColor: theme.raised, borderColor: theme.borderStrong }]}>
            {usage.groups.map((group) => (
              <View key={group.key} style={{ gap: 8 }}>
                <View style={styles.groupHead}>
                  <BrandMark id={provider} size={16} color={theme.text} />
                  <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16, flex: 1 }}>{group.row.label}</Text>
                  {group.row.identity ? <Text numberOfLines={1} style={{ color: theme.textMuted, fontSize: TEXT.label, maxWidth: 140 }}>{group.row.identity}</Text> : null}
                </View>
                {windowsOf(usage.limits[group.key]).map((win) => {
                  const left = windowLeft(win);
                  return (
                    <View key={win.label} style={{ gap: 6 }}>
                      <View style={styles.groupHead}>
                        <Text style={{ color: theme.text, fontSize: TEXT.body, flex: 1 }}>{win.label}</Text>
                        <Text style={{ color: theme.textMuted, fontSize: 12.5 }}>{windowLabel(lang, win)}</Text>
                      </View>
                      <View style={[styles.longTrack, { backgroundColor: theme.border }]}>
                        <View style={[styles.fill, { width: `${100 - left}%`, backgroundColor: toneColor(theme, left) }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
            <View style={styles.buttons}>
              <Tap accessibilityRole="button" onPress={() => setRevision((n) => n + 1)} style={[styles.button, { backgroundColor: theme.muted }]}>
                <Text style={{ color: theme.text, fontWeight: "600" }}>{t("alpha.refresh")}</Text>
              </Tap>
              <Tap accessibilityRole="button" onPress={() => { setAnchor(null); router.push("/accounts"); }} style={[styles.button, { backgroundColor: theme.text }]}>
                <Text style={{ color: theme.onPrimary, fontWeight: "600" }}>{w("usage.manage_accounts")}</Text>
              </Tap>
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 2, paddingLeft: 16, paddingRight: 8, minHeight: 44 },
  place: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  placeText: { fontSize: TEXT.ui },
  tool: { minWidth: 40, height: 40, flexDirection: "row", gap: 3, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.lg, paddingHorizontal: 4 },
  track: { width: 34, height: 5, borderRadius: 3, overflow: "hidden" },
  longTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  find: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginBottom: 8, height: 40, borderRadius: 10, paddingLeft: 12 },
  findInput: { flex: 1, fontSize: TEXT.lead, minWidth: 0, ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null) },
  close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  popover: { position: "absolute", left: 16, right: 16, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 16, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, elevation: 10 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttons: { flexDirection: "row", gap: 8 },
  button: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
