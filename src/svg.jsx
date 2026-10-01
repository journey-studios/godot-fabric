import React from "react";
import { NativeControl } from "./components";
import { svgPayload } from "./svg-contract.mjs";

function primitive(tag) {
  return function GodotSvgPrimitive(props) {
    const root = tag === "svg";
    return (
      <NativeControl
        kind="svg"
        svg={svgPayload(tag, props)}
        testID={props.testID}
        pointerEvents="none"
        style={
          root
            ? { width: Number(props.width), height: Number(props.height) }
            : { position: "absolute", width: 0, height: 0 }
        }
      >
        {tag === "text" ? null : props.children}
      </NativeControl>
    );
  };
}
export const G = primitive("g");
export const Path = primitive("path");
export const Rect = primitive("rect");
export const Circle = primitive("circle");
export const Line = primitive("line");
export const Text = primitive("text");
export const Defs = primitive("defs");
export const ClipPath = primitive("clipPath");
export const LinearGradient = primitive("linearGradient");
export const Stop = primitive("stop");
export default primitive("svg");
