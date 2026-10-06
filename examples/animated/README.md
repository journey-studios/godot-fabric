# Animated

```sh
npm run example -- animated
npm run example -- animated --headless
npm run example -- animated --capture
```

RN's original `Animated`, `Easing`, `useAnimatedValue` and `TouchableOpacity`
through the public `react-native` import. A box moves, rotates and fades with
`useNativeDriver: true`: RN's own C++ Native Animated and AnimationBackend
animate it, and Godot's frame tick is their clock. The two buttons are
`TouchableOpacity`.
