import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { useWorkspaceLogo } from "../lib/workspaceLogo";
import { Avatar } from "./components";

/**
 * La ficha de un workspace: su logo de la cuenta encima de la inicial. Sin
 * logo, mientras carga o si la imagen falla, queda la inicial de siempre.
 */
export function WorkspaceAvatar({ id, name, size = 32 }: { id: string | null | undefined; name: string; size?: number }) {
  const logo = useWorkspaceLogo(id);
  const [broken, setBroken] = useState<string | null>(null);
  useEffect(() => setBroken(null), [id]);
  return (
    <View style={{ width: size, height: size }}>
      <Avatar name={name} size={size} />
      {logo && broken !== logo ? (
        <Image
          testID={`workspace-logo-${id}`}
          source={{ uri: logo }}
          accessibilityIgnoresInvertColors
          onError={() => setBroken(logo)}
          style={{ position: "absolute", width: size, height: size, borderRadius: size / 4 }}
        />
      ) : null}
    </View>
  );
}
