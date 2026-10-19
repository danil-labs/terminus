import { dockStatusText, orderDockAgents } from "@terminus/tasks";
import { router } from "expo-router";
import { Pressable, ScrollView, Text } from "react-native";
import { lang, w } from "../lib/i18n";
import { useWorkspaces } from "../lib/workspaces";
import { Avatar, Row } from "../ui/components";
import { useTheme } from "../ui/theme";

/** «Ver todos» del dock: cada agente con su estado, su chat y sus tareas. */
export default function Agents() {
  const theme = useTheme();
  const { current, snapshot, space, view, setView } = useWorkspaces();
  const agents = orderDockAgents(
    (snapshot?.agents ?? []).filter((a) => !space || a.places.some((p) => space.folders.includes(p.folder))),
  );
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingVertical: 8 }}>
      {agents.map((agent) => (
        <Row
          key={agent.name}
          testID={`agents-${agent.name}`}
          left={<Avatar name={agent.name} size={36} round />}
          title={agent.name}
          subtitle={dockStatusText(lang, agent)}
          onPress={() => {
            router.back();
            if (current) router.push({ pathname: "/agent/[workspace]/[name]", params: { workspace: current.id, name: agent.name } });
          }}
          right={
            <Pressable
              hitSlop={8}
              onPress={() => {
                setView({ ...view, agent: agent.name });
                router.back();
              }}
            >
              <Text style={{ color: theme.primary, fontWeight: "600" }}>{w("shell.agent_dock.see_tasks")}</Text>
            </Pressable>
          }
        />
      ))}
    </ScrollView>
  );
}
