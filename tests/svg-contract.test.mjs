import { test } from "node:test";
import assert from "node:assert/strict";
import { svgPayload } from "../src/svg-contract.mjs";

test("SVG subset preserves path syntax, SVG casing, zero and text baseline", () => {
  assert.equal(
    JSON.parse(
      svgPayload("path", { d: "M0 0 C20 30 40 10 60 0", strokeWidth: 0 }),
    ).attrs["stroke-width"],
    "0",
  );
  assert.equal(
    JSON.parse(
      svgPayload("svg", { width: 320, height: 180, viewBox: "0 0 320 180" }),
    ).attrs.viewBox,
    "0 0 320 180",
  );
  const text = JSON.parse(
    svgPayload("text", {
      x: 0,
      y: 20,
      children: ["Preço <&> ", 42],
      textAnchor: "end",
      fontWeight: "600",
    }),
  );
  assert.equal(text.text, "Preço <&> 42");
  assert.equal(text.attrs["text-anchor"], "end");
});

test("Unsupported native contracts fail instead of disappearing from a chart", () => {
  for (const [tag, props, expected] of [
    ["image", {}, /primitive/],
    ["path", { d: "M0 0", transform: "rotate(30)" }, /transform/],
    ["g", { opacity: 0.5 }, /inheritance/],
    ["text", { clipPath: "url(#a)" }, /clipping/],
    ["text", { children: {}, x: 0 }, /plain/],
    ["text", { x: "50%" }, /numeric/],
    ["text", { fontFamily: "Custom" }, /fontFamily/],
    ["text", { stroke: "#ffffff" }, /stroke/],
    ["text", { fill: "url(#gradient)" }, /hex/],
    ["text", { fontSize: -1 }, /positive integer/],
    ["text", { fontSize: 12.5 }, /positive integer/],
    ["svg", { width: 320, height: 180, opacity: 0.5 }, /inheritance/],
    ["svg", { width: 3000, height: 180 }, /2048/],
    ["svg", { width: 320, height: 180, viewBox: "0 0 100 100" }, /viewBox/],
    ["circle", { r: Infinity }, /finite/],
    ["rect", { width: NaN }, /finite/],
  ])
    assert.throws(() => svgPayload(tag, props), expected);
});
