import React from "react";
import type { ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { ICONS } from "./icons";
import type { IconName } from "./icons";

// The little the panels share: a boxed panel, a button and an icon. They are the components and props of the 0.5 scope
// (docs/compatibility/scope-0.5.json): View, Text, Pressable and Image with testID, style, source, onPress and disabled.

export const COLORS = {
  panel: "#0f172a", border: "#334155", text: "#f8fafc", muted: "#94a3b8", accent: "#fbbf24", resource: "#a7f3d0",
  reason: "#fca5a5", action: "#0369a1", inert: "#334155", warning: "#b45309", neutral: "#475569",
};

/** A panel is a positioned box: it claims only the pixels it covers, so the map around it stays the World's. */
export function Panel({ id, style, children }: { id: string; style: object; children: ReactNode }) {
  return <View testID={id}
    style={{ backgroundColor: COLORS.panel, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, gap: 4, ...style }}>
    {children}
  </View>;
}

export function Heading({ id, children }: { id: string; children: string }) {
  return <Text testID={id} style={{ color: COLORS.accent, fontSize: 15, fontWeight: "700" }}>{children}</Text>;
}

export function Line({ id, children, color = COLORS.text, size = 13 }: { id: string; children: string; color?: string; size?: number }) {
  return <Text testID={id} style={{ color, fontSize: size }}>{children}</Text>;
}

/** The refusal the game gave, shown next to the action it refused. */
export function Reason({ id, children }: { id: string; children: string }) {
  return <Text testID={id} style={{ flexShrink: 1, color: COLORS.reason, fontSize: 12 }}>{children}</Text>;
}

/** One of the HUD's icons, an Image of a 32x32 PNG drawn at `size`. */
export function Icon({ id, name, size = 18 }: { id: string; name: IconName; size?: number }) {
  return <Image testID={id} source={ICONS[name]} style={{ width: size, height: size }} />;
}

/** A Pressable around a label, grey and inert while the game says the action is not enabled; with an icon, the icon comes first. */
export function Choice({ id, label, enabled, onPress, color = COLORS.action, icon }: {
  id: string; label: string; enabled: boolean; onPress: () => void; color?: string; icon?: IconName;
}) {
  return <Pressable testID={id} disabled={!enabled} onPress={onPress}
    style={{ backgroundColor: enabled ? color : COLORS.inert, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6,
      ...(icon === undefined ? {} : { flexDirection: "row", alignItems: "center", gap: 6 }) }}>
    {icon === undefined ? null : <Icon id={`${id}-icon`} name={icon} size={20} />}
    <Text testID={`${id}-label`} style={{ color: enabled ? COLORS.text : COLORS.muted, fontSize: 14 }}>{label}</Text>
  </Pressable>;
}
