import { folderColor } from "@terminus/design";
import type { SidebarDensity } from "@terminus/tasks";
import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Task } from "../lib/engine";
import { t, w } from "../lib/i18n";
import type { TaskCard as Card } from "@terminus/tasks";
import { Avatar } from "./components";
import { TaskMark } from "./TaskStatus";
import { useTheme } from "./theme";

/** El cuadrado de color de una carpeta, que la identifica en la lista plana. */
export function FolderSquare({ id, size = 8 }: { id: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 2.5, backgroundColor: folderColor(id) }} />;
}

/**
 * La tarjeta de dos líneas del sidebar del escritorio, en el teléfono. Línea 1:
 * la marca en su columna, el título y la chincheta. Línea 2: lo que te piden si
 * te necesita; si no, carpeta, agente y máquina. «Compacta», una sola línea.
 * Qué va en cada línea lo decide `taskCard` de `@terminus/tasks`.
 */
export function TaskCard({
  task,
  card,
  folderName,
  density,
  onPress,
}: {
  task: Task;
  card: Card;
  folderName: (id: string) => string | undefined;
  density: SidebarDensity;
  onPress: () => void;
}) {
  const theme = useTheme();
  const compact = density === "compact";
  const folder = card.folder ? { id: card.folder, name: folderName(card.folder) } : null;
  return (
    <Pressable
      testID={`task-${task.host}-${task.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? theme.muted : "transparent" }]}
    >
      <View style={styles.line}>
        <View style={styles.mark}>
          {card.state || card.delivered ? (
            <TaskMark state={card.state} delivered={card.delivered} size={15} />
          ) : (
            <View style={[styles.hollow, { borderColor: theme.border }]} />
          )}
        </View>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text, fontWeight: card.needsYou || card.state === "unseen" ? "700" : "500" }]}>
          {task.title}
        </Text>
        {card.pinned ? (
          <View accessibilityLabel={w("projects.sessions.pinned")}>
            <SymbolView name="pin.fill" size={11} tintColor={theme.textMuted} fallback={null} />
          </View>
        ) : null}
        {compact && folder ? <FolderSquare id={folder.id} /> : null}
      </View>
      {compact ? null : (
        <View style={[styles.line, styles.second]}>
          {card.needsYou ? (
            <>
              <Text numberOfLines={1} style={[styles.request, { color: theme.text }]}>
                {card.request ?? ""}
              </Text>
              {folder ? <FolderSquare id={folder.id} /> : null}
            </>
          ) : (
            <>
              {folder ? (
                <View style={styles.chip}>
                  <FolderSquare id={folder.id} />
                  <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted, maxWidth: 140 }]}>
                    {folder.name ?? folder.id}
                  </Text>
                </View>
              ) : null}
              {card.agent ? <Avatar name={card.agent} size={14} round /> : null}
              {card.machine ? (
                <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted, maxWidth: 120, opacity: card.machine.on ? 1 : 0.6 }]}>
                  {card.machine.on ? card.machine.id : t("machines.chip_off", { name: card.machine.id })}
                </Text>
              ) : null}
            </>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 16, paddingVertical: 8, gap: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 18 },
  second: { paddingLeft: 26, gap: 8 },
  mark: { width: 18, alignItems: "center" },
  hollow: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  title: { flex: 1, fontSize: 15 },
  request: { flex: 1, fontSize: 13 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  meta: { fontSize: 12 },
});
