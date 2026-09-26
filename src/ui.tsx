import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors } from './theme';

export function Button({ title, onPress, primary, disabled }: { title: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[s.btn, primary ? s.primary : s.secondary, disabled && { opacity: 0.5 }]}
    >
      <Text style={s.btnText}>{title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{props.label}</Text>
      <TextInput placeholderTextColor={colors.slate} {...props} style={[s.input, props.style]} />
    </View>
  );
}

export function Tag({ text, kind }: { text: string; kind: 'event' | 'place' }) {
  return (
    <View style={[s.tag, { backgroundColor: kind === 'event' ? colors.heather : colors.lichen }]}>
      <Text style={s.tagText}>{text}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: colors.mist },
  h: { fontSize: 20, fontWeight: '700', color: colors.fjord },
  body: { fontSize: 15, color: colors.fjord },
  meta: { fontSize: 13, color: colors.slate },
  label: { fontSize: 13, color: colors.slate, fontWeight: '600' },
  input: { backgroundColor: colors.white, borderRadius: 10, padding: 12, fontSize: 16, color: colors.fjord },
  card: { backgroundColor: colors.white, borderRadius: 12, padding: 14, gap: 6 },
  btn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primary: { backgroundColor: colors.glance },
  secondary: { backgroundColor: colors.white },
  btnText: { color: colors.fjord, fontSize: 16, fontWeight: '700' },
  tag: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  tagText: { color: colors.fjord, fontSize: 12, fontWeight: '600' },
});
