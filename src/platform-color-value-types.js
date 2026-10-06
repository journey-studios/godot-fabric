// Godot's variant of RN's PlatformColorValueTypes (iOS and Android ship their
// own). Godot has no OS color resources: PlatformColor fails where it is
// called, and no color object is a platform color.
export function PlatformColor() {
  throw new Error("Godot platform does not implement PlatformColor");
}
export function normalizeColorObject() {
  return null;
}
export function processColorObject() {
  return null;
}
