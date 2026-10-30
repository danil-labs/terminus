import { t, w } from "./i18n";
import { spaceName, useWorkspaces } from "./workspaces";

/** Lo que dice el atrás hacia Inicio: el título grande de Inicio (el espacio o, sin espacios, el workspace). */
export function useHomeLabel(): string {
  const { space, current } = useWorkspaces();
  return space ? spaceName(space, t("space.general")) : current?.name ?? w("common.brand_name");
}
