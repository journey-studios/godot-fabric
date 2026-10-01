import React from "react";
import { View, Text } from "react-native";

export function LineHeightProbe() {
  return (
    <View style={{ width: 600 }}>
      <Text testID="leading-small-first" style={{ fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 }}>
        <Text>{"Short\n"}</Text><Text style={{ lineHeight: 42 }}>Tall</Text>
      </Text>
      <Text testID="leading-large-first" style={{ fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 }}>
        <Text style={{ lineHeight: 42 }}>{"Tall\n"}</Text><Text>Short</Text>
      </Text>
      <Text testID="leading-terminal" style={{ fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 }}>
        <Text style={{ lineHeight: 42 }}>{"Tall\n"}</Text>
      </Text>
      <Text testID="leading-empty" style={{ fontFamily: "NotoSans", fontSize: 14, lineHeight: 27 }} />
    </View>
  );
}
