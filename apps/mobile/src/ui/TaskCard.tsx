import { folderColor } from "@terminus/design";
import { type SidebarDensity, type TaskCard as Card, taskTitle } from "@terminus/tasks";
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Task } from "../lib/engine";
import { lang, w } from "../lib/i18n";
import { Avatar } from "./components";
import { Icon } from "./Icon";
import { TaskMark } from "./TaskStatus";
import { useTheme } from "./theme";

/** El cuadrado de color de una carpeta, que la identifica en la lista plana. */
export function FolderSquare({ id, size = 8 }: { id: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 2, backgroundColor: folderColor(id) }} />;
}

/**
 * La chapa de la máquina que corre la tarea, como `MachineChip` del escritorio:
 * el servidor y su nombre; apagada, más tenue (nunca como error).
 */
export function MachineChip({ name, on, size = 12 }: { name: string; on: boolean; size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.chip, { opacity: on ? 1 : 0.6 }]} accessibilityLabel={on ? name : w("shell.machines.task_off", { name })}>
      <Icon name="server" size={size - 1} color={theme.textMuted} />
      <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted, maxWidth: 110, fontSize: size }]}>
        {name}
      </Text>
    </View>
  );
}

/**
 * La tarjeta de dos líneas del sidebar del escritorio (#151), en el teléfono.
 * Línea 1: la marca en su columna, el título y la chincheta. Línea 2: lo que te
 * piden si te necesita (y el cuadrado de su carpeta); si no, la carpeta, la
 * máquina y la cara del agente. «Compacta», una sola línea con el cuadrado.
 * Qué va en cada línea lo decide `taskCard` de `@terminus/tasks`. Mantenerla
 * pulsada abre la vista previa (la tarjeta flotante del escritorio).
 */
export function TaskCard({
  task,
  card,
  folderName,
  density,
  onPress,
  onLongPress,
}: {
  task: Task;
  card: Card;
  folderName: (id: string) => string | undefined;
  density: SidebarDensity;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const compact = density === "compact";
  const folder = card.folder ? { id: card.folder, name: folderName(card.folder) } : null;
  return (
    <Pressable
      testID={`task-${task.host}-${task.id}`}
      onPress={onPress}
      onLongPress={
        onLongPress
          ? () => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onLongPress();
            }
          : undefined
      }
      delayLongPress={350}
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
        <Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>
          {taskTitle(lang, task)}
        </Text>
        {card.pinned ? (
          <View accessibilityRole="image" accessibilityLabel={w("projects.sessions.pinned")}>
            <Icon name="pin" size={13} color={theme.textMuted} />
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
                  <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted, maxWidth: 130 }]}>
                    {folder.name ?? folder.id}
                  </Text>
                </View>
              ) : null}
              {card.machine ? <MachineChip name={card.machine.id} on={card.machine.on} /> : null}
              {card.agent ? <Avatar name={card.agent} size={14} round /> : null}
            </>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 16, paddingVertical: 8, gap: 3 },
  line: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 18 },
  second: { paddingLeft: 24, gap: 8 },
  mark: { width: 18, alignItems: "center" },
  hollow: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  title: { flex: 1, fontSize: 15, fontWeight: "500" },
  request: { flex: 1, fontSize: 13 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  meta: { fontSize: 12 },
});
