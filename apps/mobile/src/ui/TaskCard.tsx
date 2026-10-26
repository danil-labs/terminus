import { folderColor } from "@terminus/design";
import { type CardPull, type SidebarDensity, type TaskCard as Card, type PullTone, cardPull, canFinishTask, type TaskGit, type TaskGitStatus, taskTitle } from "@terminus/tasks";
import * as Haptics from "expo-haptics";
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { secondLine } from "../lib/cardLine";
import { sameCard } from "../lib/reconcile";
import type { Task } from "../lib/engine";
import { lang, t, w } from "../lib/i18n";
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
export function PullChip({ pull, git }: { pull: CardPull; git?: TaskGit | null }) {
  const theme = useTheme();
  const checks = git?.pull_known && git.head === git.pull?.head_sha ? git.pull?.checks : undefined;
  const state = t(`task.git.${pull.state}`);
  const checkLabel = !git?.stale && (pull.state === "open" || pull.state === "draft") && (checks === "pending" || checks === "failure") ? t(`task.git.checks.${checks}`) : state;
  const label = git?.stale ? t("task.git.stale_short") : checkLabel;
  return (
    <View testID="task-pull" style={[styles.chip, { minWidth: 0, maxWidth: 200 }]} accessibilityLabel={`#${pull.number}, ${state}${label === state ? "" : `, ${label}`}`}>
      <Icon name={PULL_ICONS[pull.state]} size={11} color={toneColor(theme, pull.tone)} />
      <Text numberOfLines={1} style={[styles.meta, { flexShrink: 1, color: toneColor(theme, pull.numberTone) }]}>#{pull.number} · {label}</Text>
    </View>
  );
}

type TaskCardProps = {
  task: Task;
  card: Card;
  git?: TaskGitStatus | null;
  folderName: (id: string) => string | undefined;
  density: SidebarDensity;
  onPress: () => void;
  onLongPress?: () => void;
  onFinish?: () => void;
  online: boolean;
};

/**
 * Una tarjeta solo se repinta si cambia lo que enseña: su tarea (el mismo
 * objeto mientras no cambie, `keepSame`), su tarjeta, su git, el nombre de su
 * carpeta o la densidad. `onPress` y `onLongPress` llegan nuevas en cada render
 * pero solo abren la tarea, que es la misma: no cuentan.
 */
const sameProps = (a: TaskCardProps, b: TaskCardProps) =>
  a.task === b.task &&
  a.density === b.density &&
  a.git === b.git &&
  a.online === b.online &&
  !a.onFinish === !b.onFinish &&
  !a.onLongPress === !b.onLongPress &&
  !a.onFinish === !b.onFinish &&
  sameCard(a.card, b.card) &&
  (a.card.folder ? a.folderName(a.card.folder) : null) === (b.card.folder ? b.folderName(b.card.folder) : null);

/**
 * La tarjeta de dos líneas del sidebar del escritorio (#151), en el teléfono.
 * Línea 1: la marca en su columna, el título y la chincheta. Línea 2: proveedor ·
 * carpeta · máquina · cara del agente · PR, incluso cuando espera respuesta.
 * «Compacta», una sola línea con el cuadrado. Qué va en cada línea lo deciden
 * `taskCard` de `@terminus/tasks` y `secondLine`; el PR sale de `git` (una fila
 * de `list_session_git`), que quien pinta la lista pide solo para las visibles.
 * Mantenerla pulsada abre la vista previa (la tarjeta flotante del escritorio).
 */
export const TaskCard = memo(TaskCardView, sameProps);

function TaskCardView({
  task,
  card,
  git,
  folderName,
  density,
  onPress,
  onLongPress,
  onFinish,
  online,
}: TaskCardProps) {
  const theme = useTheme();
  const compact = density === "compact";
  const folder = card.folder ? { id: card.folder, name: folderName(card.folder) } : null;
  const pull = cardPull(git);
  const chips = secondLine(card, pull, compact);
  const branch = !git?.shared_with ? git?.branch : null;
  const ready = online && canFinishTask(task, git, card.activity.viva || card.activity.aprobando);
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
        {compact && pull ? <PullChip pull={pull} git={git} /> : null}
        {onFinish ? <Pressable testID={`finish-${task.host}-${task.id}`} accessibilityRole="button" accessibilityLabel={`${t("task.header.finish")}: ${taskTitle(lang, task)}`} accessibilityState={{ disabled: !ready }} disabled={!ready} hitSlop={8} onPress={(event) => { event.stopPropagation(); onFinish(); }} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", marginVertical: -8, opacity: ready ? 1 : 0.3 }}>
          <Icon name="rocket" size={18} color={theme.merged} />
        </Pressable> : null}
        {onLongPress ? <Pressable accessibilityRole="button" accessibilityLabel={`${t("task.actions.menu")}: ${taskTitle(lang, task)}`} hitSlop={8} onPress={(event) => { event.stopPropagation(); onLongPress(); }} style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", marginVertical: -8 }}>
          <Icon name="ellipsis" size={17} color={theme.textMuted} />
        </Pressable> : null}
      </View>
      {compact ? null : (
        <View style={[styles.line, styles.second]}>
          {chips.map((chip) => {
            switch (chip) {
              case "provider":
                return (
                  <View key={chip} testID="task-provider" accessibilityRole="image" accessibilityLabel={card.provider ?? ""}>
                    <BrandMark id={card.provider} size={13} color={theme.text} />
                  </View>
                );
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
                return pull ? <PullChip key={chip} pull={pull} git={git} /> : null;
            }
          })}
          {!pull && branch ? (
            <View style={styles.chip} accessibilityLabel={branch}>
              <Icon name="git-branch" size={11} color={theme.textMuted} />
              <Text numberOfLines={1} style={[styles.meta, { color: theme.textMuted, maxWidth: 160 }]}>{branch}</Text>
            </View>
          ) : null}
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
  chip: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  meta: { fontSize: 12 },
});
