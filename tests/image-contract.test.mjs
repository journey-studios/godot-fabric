import assert from "node:assert/strict";
import test from "node:test";
import {validateImageProps} from "../src/image-contract.mjs";

// The contract of the Godot Image: which of RN's ImageProps are mistakes, before RN's Image.ios.js renders anything.
const style = {width: true, height: true, opacity: true, backgroundColor: true, borderWidth: true, position: true, borderRadius: true, borderTopLeftRadius: true,
  borderTopRightRadius: true, borderBottomLeftRadius: true, borderBottomRightRadius: true};
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

test("the props that draw and the props iOS ignores are taken: none is refused", () => {
  check({tintColor: "#f00", blurRadius: 2, capInsets: {top: 1, left: 1, bottom: 1, right: 1}});
  check({capInsets: 4});
  check({capInsets: {top: 1}});
  check({blurRadius: 0});
  for (const [name, value] of Object.entries({defaultSource: 1, loadingIndicatorSource: {uri: "x"}, fadeDuration: 1, progressiveRenderingEnabled: true,
    resizeMethod: "resize", resizeMultiplier: 2, overlayColor: "#fff"})) {
    check({[name]: value});
  }
  for (const name of ["tintColor", "overlayColor"]) {
    check({style: {[name]: "#f00"}});
  }
  for (const name of ["borderRadius", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"]) {
    check({style: {[name]: 4}});
  }
});

test("a blur radius and cap insets that are not numbers are mistakes", () => {
  for (const value of ["2", Number.NaN, Number.POSITIVE_INFINITY, {}]) {
    assert.throws(() => check({blurRadius: value}), /^Error: Godot Image blurRadius must be a finite number$/, String(value));
  }
  for (const value of ["1", [1, 2, 3, 4], [1, 2, 3], {top: "1"}, {middle: 1}, Number.NaN]) {
    assert.throws(() => check({capInsets: value}), /^Error: Godot Image capInsets must be a number or an object of top, left, bottom and right numbers$/, JSON.stringify(value));
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
