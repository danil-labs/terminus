import { folderColor } from "@terminus/design";
import { type CardPull, type SidebarDensity, type TaskCard as Card, type PullTone, cardPull, type TaskGit, taskTitle } from "@terminus/tasks";
import * as Haptics from "expo-haptics";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { secondLine } from "../lib/cardLine";
import type { Task } from "../lib/engine";
import { lang, w } from "../lib/i18n";
import { BrandMark } from "./BrandMark";
import { Avatar } from "./components";
import { Icon, type IconName } from "./Icon";
import { TaskMark } from "./TaskStatus";
import { type Theme, useTheme } from "./theme";

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

const PULL_ICONS: Record<CardPull["state"], IconName> = {
  open: "git-pull-request",
  draft: "git-pull-request-draft",
  closed: "git-pull-request-closed",
  merged: "git-merge",
  merged_other_head: "git-branch",
};

const toneColor = (theme: Theme, tone: PullTone) =>
  tone === "open" ? theme.unseenMark : tone === "closed" || tone === "failure" ? theme.failedMark : tone === "merged" ? theme.merged : theme.textMuted;

/** El PR de la tarea, como `ChipDeGit` del riel: su icono y `#número`, rojo si el CI falló. */
export function PullChip({ pull }: { pull: CardPull }) {
  const theme = useTheme();
  return (
    <View testID="task-pull" style={styles.chip} accessibilityLabel={`#${pull.number}`}>
      <Icon name={PULL_ICONS[pull.state]} size={11} color={toneColor(theme, pull.tone)} />
      <Text style={[styles.meta, { color: toneColor(theme, pull.numberTone) }]}>#{pull.number}</Text>
    </View>
  );
}

/**
 * La tarjeta de dos líneas del sidebar del escritorio (#151), en el teléfono.
 * Línea 1: la marca en su columna, el título y la chincheta. Línea 2: lo que te
 * piden si te necesita (su PR y el cuadrado de su carpeta); si no, proveedor ·
 * carpeta · máquina · cara del agente · PR, como el riel del escritorio.
 * «Compacta», una sola línea con el cuadrado. Qué va en cada línea lo deciden
 * `taskCard` de `@terminus/tasks` y `secondLine`; el PR sale de `git` (una fila
 * de `list_session_git`), que quien pinta la lista pide solo para las visibles.
 * Mantenerla pulsada abre la vista previa (la tarjeta flotante del escritorio).
 */
export function TaskCard({
  task,
  card,
  git,
  folderName,
  density,
  onPress,
  onLongPress,
}: {
  task: Task;
  card: Card;
  git?: TaskGit | null;
  folderName: (id: string) => string | undefined;
  density: SidebarDensity;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const compact = density === "compact";
  const folder = card.folder ? { id: card.folder, name: folderName(card.folder) } : null;
  const pull = cardPull(git);
  const chips = secondLine(card, pull, compact);
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
          {chips.map((chip) => {
            switch (chip) {
              case "request":
                return (
                  <Text key={chip} numberOfLines={1} style={[styles.request, { color: theme.text }]}>
                    {card.request ?? ""}
                  </Text>
                );
              case "provider":
                return (
                  <View key={chip} testID="task-provider" accessibilityRole="image" accessibilityLabel={card.provider ?? ""}>
                    <BrandMark id={card.provider} size={13} color={theme.text} />
                  </View>
                );
              case "folder-square":
                return folder ? <FolderSquare key={chip} id={folder.id} /> : null;
              case "folder":
                return folder ? (
                  <View key={chip} style={styles.chip}>
                    <FolderSquare id={folder.id} />
                    <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted, maxWidth: 130 }]}>
                      {folder.name ?? folder.id}
                    </Text>
                  </View>
                ) : null;
              case "machine":
                return card.machine ? <MachineChip key={chip} name={card.machine.id} on={card.machine.on} /> : null;
              case "agent":
                return card.agent ? <Avatar key={chip} name={card.agent} size={14} round /> : null;
              case "pull":
                return pull ? <PullChip key={chip} pull={pull} /> : null;
            }
          })}
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
