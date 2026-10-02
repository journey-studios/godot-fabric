import React, { useEffect, useState } from "react";
import { View, Text, Button, Pressable } from "../../src/components";

const observations = { events: [], cleanups: 0 };
const actions = {};
function record(id, type, event, version) {
  const native = event?.nativeEvent;
  observations.events.push({
    id,
    type,
    version,
    target: native?.target,
    currentTarget: event?.currentTarget?.tag,
    x: native?.pageX,
    y: native?.pageY,
    locationX: native?.locationX,
    locationY: native?.locationY,
    identifier: native?.identifier,
    touches: native?.touches?.length,
    changedTouches: native?.changedTouches?.length,
    timestamp: native?.timestamp,
  });
}
function events(id, version) {
  return Object.fromEntries(
    ["PressIn", "PressOut", "Press", "LongPress", "PressMove"].map((name) => [
      `on${name}`,
      (event) => record(id, name, event, version),
    ]),
  );
}
export function PressableApp() {
  const [rowHidden, setRowHidden] = useState(false);
  const [nativeMode, setNativeMode] = useState("auto");
  const [version, setVersion] = useState(1);
  const [reverse, setReverse] = useState(false);
  const [present, setPresent] = useState(true);
  const [transfer, setTransfer] = useState(false);
  const [cancelable, setCancelable] = useState(true);
  const [block, setBlock] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [stopTouches, setStopTouches] = useState(false);
  const [overlay, setOverlay] = useState("none");
  actions.hideRow = () => setRowHidden((value) => !value);
  actions.nativeMode = () =>
    setNativeMode((value) => (value === "auto" ? "none" : "auto"));
  actions.stopTouches = () => setStopTouches((value) => !value);
  actions.clear = () => {
    observations.events.length = 0;
  };
  actions.version = () => setVersion((value) => value + 1);
  actions.reorder = () => setReverse((value) => !value);
  actions.remove = () => setPresent(false);
  actions.transfer = () => setTransfer(true);
  actions.hold = () => {
    setTransfer(false);
    setCancelable(false);
  };
  actions.resetTransfer = () => {
    setTransfer(false);
    setCancelable(true);
  };
  actions.block = () => setBlock((value) => !value);
  actions.disable = () => setDisabled(true);
  actions.overlay = (value) => setOverlay(value);
  useEffect(
    () => () => {
      observations.cleanups++;
    },
    [],
  );
  const basics = ["basic", "spare"];
  if (reverse) basics.reverse();
  return (
    <View
      testID="press-root"
      pointerEvents="box-none"
      onTouchStartCapture={(event) => record("root", "TouchCapture", event)}
      onTouchStart={(event) => record("root", "TouchBubble", event)}
      style={{ padding: 24, gap: 14, height: "100%" }}
    >
      <Text
        text="Fabric + Godot · Pressability original do React Native"
        style={{ height: 32 }}
      />
      <View
        testID="basic-row"
        pointerEvents="box-none"
        style={{
          flexDirection: "row",
          gap: 24,
          display: rowHidden ? "none" : "flex",
        }}
      >
        {basics.map((id) => (
          <Pressable
            key={id}
            testID={id}
            {...events(id, version)}
            disabled={id === "basic" && disabled}
            onTouchStartCapture={(event) => record(id, "TouchCapture", event)}
            onTouchStart={(event) => {
              record(id, "TouchBubble", event);
              if (stopTouches) event.stopPropagation();
            }}
            style={({ pressed }) => ({
              width: 300,
              height: 64,
              opacity: pressed ? 0.5 : 1,
            })}
          >
            {({ pressed }) => (
              <Text
                testID={`${id}-state`}
                text={`${id}: ${pressed ? "pressionado" : "pronto"} · handler ${version}`}
                style={{ height: 64 }}
              />
            )}
          </Pressable>
        ))}
      </View>
      <View pointerEvents="box-none" style={{ flexDirection: "row", gap: 24 }}>
        <Pressable
          testID="outer"
          {...events("outer")}
          style={{ width: 300, height: 88, padding: 12 }}
        >
          <Pressable
            testID="inner"
            {...events("inner")}
            style={{ width: 200, height: 50 }}
          >
            <Text text="Pressable filho" style={{ height: 50 }} />
          </Pressable>
        </Pressable>
        <Pressable
          testID="disabled"
          disabled
          {...events("disabled")}
          style={{ width: 300, height: 88 }}
        >
          <Text text="Desabilitado" style={{ height: 88 }} />
        </Pressable>
      </View>
      <View
        testID="negotiator"
        pointerEvents="box-none"
        onMoveShouldSetResponderCapture={() => transfer}
        onResponderGrant={(event) => {
          record("parent", "Grant", event);
          return true;
        }}
        onResponderReject={(event) => record("parent", "Reject", event)}
        onResponderMove={(event) => record("parent", "Move", event)}
        onResponderRelease={(event) => record("parent", "Release", event)}
        style={{ width: 620, height: 64 }}
      >
        <Pressable
          testID="negotiated"
          cancelable={cancelable}
          {...events("negotiated")}
          style={{ width: 300, height: 64 }}
        >
          <Text text="Transferir / recusar responder" style={{ height: 64 }} />
        </Pressable>
      </View>
      <View pointerEvents="box-none" style={{ flexDirection: "row", gap: 24 }}>
        <View
          testID="native-parent"
          onStartShouldSetResponderCapture={() => block}
          onResponderGrant={(event) => {
            record("native-parent", "Grant", event);
            return true;
          }}
          onResponderRelease={(event) =>
            record("native-parent", "Release", event)
          }
          style={{ width: 300, height: 64 }}
        >
          <Button
            testID="native-button"
            pointerEvents={nativeMode}
            text="Godot Button / bloqueio nativo"
            onActivate={(event) => record("native-button", "Activate", event)}
            style={{ width: 300, height: 64 }}
          />
        </View>
        <Pressable
          testID="delayed"
          unstable_pressDelay={180}
          delayLongPress={240}
          {...events("delayed")}
          style={{ width: 300, height: 64 }}
        >
          <Text text="Pressão com delay" style={{ height: 64 }} />
        </Pressable>
      </View>
      <View
        testID="hit-parent"
        pointerEvents="box-none"
        style={{
          width: 620,
          height: 64,
          flexDirection: "row",
          gap: 80,
          paddingLeft: 12,
        }}
      >
        <Pressable
          testID="slop"
          hitSlop={20}
          pressRetentionOffset={10}
          {...events("slop")}
          style={{ width: 100, height: 44 }}
        >
          <Text text="HitSlop" style={{ height: 44 }} />
        </Pressable>
        <Pressable
          testID="long"
          delayLongPress={110}
          {...events("long")}
          style={{ width: 180, height: 44 }}
        >
          <Text text="Pressão longa" style={{ height: 44 }} />
        </Pressable>
        {present && (
          <Pressable
            testID="removable"
            delayLongPress={160}
            {...events("removable")}
            style={{ width: 180, height: 44 }}
          >
            <Text text="Desmontar no gesto" style={{ height: 44 }} />
          </Pressable>
        )}
      </View>
      <View
        testID="overlay-parent"
        pointerEvents="box-none"
        style={{ width: 620, height: 60 }}
      >
        <Pressable
          testID="underlay"
          {...events("underlay")}
          style={{ width: 300, height: 60 }}
        >
          <Text text="pointerEvents / ordem Z" style={{ height: 60 }} />
        </Pressable>
        <View
          testID="overlay"
          pointerEvents={overlay}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 300,
            height: 60,
            zIndex: 2,
          }}
        />
      </View>
    </View>
  );
}
export function runPressable(name, ...args) {
  actions[name](...args);
}
export function pressableStats() {
  return { ...observations };
}
