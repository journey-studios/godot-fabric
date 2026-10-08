// Opt-in `className` for the components NativeWind's interop covers on Godot. A project lists this file in its
// tsconfig "include"; without it `className` stays a type error. These are the original NativeWind props
// (`nativewind/types` adds the same `className` and `cssInterop`), declared for exactly the four components the
// platform certifies: View, Text, Image and Pressable. TextInput, Switch and the lists take no `className` yet.
export {};

declare module "./react-native" {
  interface ViewProps { className?: string }
  interface TextProps { className?: string }
  interface ImageProps { className?: string }
  interface PressableProps { className?: string }
}
