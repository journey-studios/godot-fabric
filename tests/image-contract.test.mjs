import assert from "node:assert/strict";
import test from "node:test";
import {validateImageProps} from "../src/image-contract.mjs";

// The contract of the Godot Image: which of RN's ImageProps it refuses, before RN's Image.ios.js renders anything.
const style = {width: true, height: true, opacity: true, backgroundColor: true, borderWidth: true, position: true};
const registered = id => id === 1;
const check = (props, flat = props.style) => validateImageProps(props, flat, style, registered);

test("the props the host implements pass, including sources it cannot load: a uri is data, not a mistake", () => {
  check({source: {uri: "https://example.com/a.png"}});
  check({source: {uri: "https://example.com/a.png", headers: {Accept: "image/png"}, method: "POST", body: "x", cache: "force-cache"}});
  check({source: [{uri: "res://a.png"}, {uri: "https://example.com/b.png", cache: "reload"}], crossOrigin: "use-credentials", referrerPolicy: "origin"});
  check({source: {uri: "res://a.png", width: 4, height: 4, scale: 2}});
  check({source: 1});
  check({source: [{uri: "res://a.png", width: 4, height: 4, scale: 1}, {uri: "res://b.png", width: 8, height: 8, scale: 2}]});
  check({source: null, tintColor: null, blurRadius: undefined});
  check({src: "res://a.png", srcSet: "res://a.png 1x, res://b.png 2x", resizeMode: "repeat", testID: "x", onLoad() {}, onProgress() {}});
  check({style: {width: 4, height: 4, resizeMode: "none", objectFit: "scale-down", opacity: 0.5, borderWidth: 1, tintColor: undefined}});
});

test("each prop the host has no native half for yet fails with its name, and says why", () => {
  const later = {tintColor: "#f00", blurRadius: 2, capInsets: {top: 1}, defaultSource: 1, loadingIndicatorSource: {uri: "x"}, fadeDuration: 1,
    progressiveRenderingEnabled: true, resizeMethod: "resize", resizeMultiplier: 2, overlayColor: "#fff"};
  for (const [name, value] of Object.entries(later)) {
    assert.throws(() => check({[name]: value}), new RegExp(`^Error: Godot Image does not implement ${name} yet: `), name);
  }
  for (const name of ["tintColor", "overlayColor"]) {
    assert.throws(() => check({style: {[name]: "#f00"}}), new RegExp(`style\\.${name} yet: `), name);
  }
  for (const name of ["borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"]) {
    assert.throws(() => check({style: {[name]: 4}}), new RegExp(`style\\.${name} yet: the host clips rectangles only`), name);
  }
});

test("values the host cannot take are refused with its own words", () => {
  assert.throws(() => check({resizeMode: "fill"}), /^Error: Godot Image resizeMode must be cover, contain, stretch, center, repeat, none$/);
  assert.throws(() => check({style: {resizeMode: "fill"}}), /resizeMode must be/);
  assert.throws(() => check({style: {objectFit: "fill-ish"}}), /^Error: Godot Image objectFit must be contain, cover, fill, scale-down, none$/);
  assert.throws(() => check({style: {aspectRatio: 1}}), /^Error: Godot Image does not implement style aspectRatio$/);
  assert.throws(() => check({source: {uri: 5}}), /source\.uri must be a string/);
  assert.throws(() => check({source: {uri: "a", width: Number.NaN}}), /source\.width must be a finite number/);
  assert.throws(() => check({source: "a.png"}), /source must be an asset/);
  assert.throws(() => check({source: 2}), /no asset registered/);
  assert.throws(() => check({src: 5}), /src must be a string/);
  assert.throws(() => check({onLoad: "x"}), /Image onLoad must be a function/);
  assert.throws(() => check({testID: 5}), /testID must be a string/);
});
