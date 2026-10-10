import React from "react";
import type { ReactNode } from "react";
import { Modal, View } from "react-native";

// An overlay is a blocking Modal: the city screen with the research list, and the event dialog. The host opens a Modal as a window of its
// own over the HUD's Surface, exclusive while it is on top, so while one is open nothing under it hears the pointer, the map included
// (docs/research/world-input.md: 0 of 100 clicks reach the world under a Modal). The backdrop is transparent and fills the window, so the
// game stays visible, dimmed, behind it; `animationType` is "none" and `presentationStyle` "overFullScreen", the two the host accepts.
// `onRequestClose` is what the host calls on Escape: each overlay says what that means for it.

export function Overlay({ id, onRequestClose, centered = false, children }: {
  id: string; onRequestClose: () => void; centered?: boolean; children: ReactNode;
}) {
  return <Modal testID={id} visible transparent animationType="none" presentationStyle="overFullScreen" onRequestClose={onRequestClose}>
    <View testID={`${id}-backdrop`}
      style={{ flex: 1, backgroundColor: "rgba(2, 6, 23, 0.62)", alignItems: centered ? "center" : "stretch", justifyContent: centered ? "center" : "flex-start" }}>
      {children}
    </View>
  </Modal>;
}
