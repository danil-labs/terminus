import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { t } from "../lib/i18n";
import { Icon } from "./Icon";
import { useTheme } from "./theme";

/** Sin acentos ni mayúsculas: buscar «administracion» encuentra la con tilde. */
const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Si alguno de los textos contiene lo buscado; sin búsqueda, todo coincide. */
export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = plain(query.trim());
  return !q || fields.some((f) => f != null && plain(f).includes(q));
}

/** El buscador de una lista: lupa, campo y la equis para borrarlo. No abre el teclado solo. */
export function SearchField({ value, onChange, placeholder, testID }: { value: string; onChange: (value: string) => void; placeholder: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.field, { backgroundColor: theme.muted }]}>
      <Icon name="search" size={15} color={theme.textMuted} />
      <TextInput
        testID={testID}
        style={[styles.input, { color: theme.text }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
      />
      {value ? (
        <Pressable hitSlop={10} accessibilityLabel={t("search.clear")} onPress={() => onChange("")}>
          <Icon name="x" size={15} color={theme.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Lo que se ve cuando la búsqueda no deja nada. */
export function NoMatch() {
  const theme = useTheme();
  return <Text style={[styles.empty, { color: theme.textMuted }]}>{t("search.no_match")}</Text>;
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 12, marginVertical: 6, paddingHorizontal: 12, borderRadius: 10, minHeight: 40 },
  input: { flex: 1, fontSize: 16, paddingVertical: 8 },
  empty: { paddingHorizontal: 18, paddingVertical: 14, fontSize: 15 },
});
