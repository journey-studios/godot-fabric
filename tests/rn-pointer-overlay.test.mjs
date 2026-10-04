import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {renderPointerOverlay, writePointerOverlay} from '../scripts/rn-pointer-overlay.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = path.join(root, 'node_modules/react-native/ReactCommon');
const base = 'react/renderer/uimanager/PointerEventsProcessor';
const bindingBase = 'react/renderer/uimanager/UIManagerBinding';
const read = extension => fs.readFileSync(path.join(original, base + '.' + extension), 'utf8');
const readBinding = extension => fs.readFileSync(path.join(original, bindingBase + '.' + extension), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'godot-fabric-pointer-overlay-'));
  t.after(() => fs.rmSync(temporary, {recursive: true, force: true}));
  const rn = path.join(temporary, 'ReactCommon');
  const output = path.join(temporary, 'generated');
  fs.mkdirSync(path.dirname(path.join(rn, base)), {recursive: true});
  for (const extension of ['h', 'cpp']) fs.writeFileSync(path.join(rn, base + '.' + extension), read(extension));
  for (const extension of ['h', 'cpp']) fs.writeFileSync(path.join(rn, bindingBase + '.' + extension), readBinding(extension));
  return {rn, output};
}

test('native overlay leaves the pinned downloaded input bytes unchanged and retains its MIT notice', t => {
  const {rn, output} = fixture(t);
  const before = {[base + '.h']: read('h'), [base + '.cpp']: read('cpp'),
    [bindingBase + '.h']: readBinding('h'), [bindingBase + '.cpp']: readBinding('cpp')};
  const files = writePointerOverlay(rn, output);
  for (const [relative, content] of Object.entries(before)) {
    assert.equal(fs.readFileSync(path.join(rn, relative), 'utf8'), content);
    assert.ok(files[relative].startsWith(content.slice(0, content.indexOf('#'))));
    assert.match(files[relative], /Copyright \(c\) Meta Platforms, Inc\. and affiliates/);
  }
});

test('overlay receipt identifies both original inputs and exact generated outputs', t => {
  const {rn, output} = fixture(t);
  const files = writePointerOverlay(rn, output);
  const manifest = JSON.parse(files['overlay-manifest.json']);
  assert.equal(manifest.reactNative, '0.87.1');
  assert.equal(manifest.format, 'godot-fabric.rn-pointer-overlay/v1');
  for (const relative of [base + '.h', base + '.cpp', bindingBase + '.h', bindingBase + '.cpp']) {
    assert.equal(manifest.originalSources[relative], hash(fs.readFileSync(path.join(rn, relative))));
    assert.equal(manifest.generatedSources[relative], hash(fs.readFileSync(path.join(output, relative))));
  }
});

test('unknown source or header versions fail before publishing any generated files', t => {
  for (const relative of [base + '.h', base + '.cpp', bindingBase + '.h', bindingBase + '.cpp']) {
    const {rn, output} = fixture(t);
    fs.appendFileSync(path.join(rn, relative), '\n// drift\n');
    assert.throws(() => writePointerOverlay(rn, output), /E_POINTER_OVERLAY_INPUT/);
    assert.equal(fs.existsSync(output), false);
  }
});

test('input drift preserves previously generated output byte-for-byte', t => {
  const {rn, output} = fixture(t);
  const files = writePointerOverlay(rn, output);
  fs.appendFileSync(path.join(rn, base + '.cpp'), '// modified downloaded source');
  assert.throws(() => writePointerOverlay(rn, output), /E_POINTER_OVERLAY_INPUT/);
  for (const [relative, content] of Object.entries(files))
    assert.equal(fs.readFileSync(path.join(output, relative), 'utf8'), content);
});

test('deterministic regeneration preserves mtimes and repairs altered generated output', t => {
  const {rn, output} = fixture(t);
  const files = writePointerOverlay(rn, output);
  const mtimes = {};
  for (const relative of Object.keys(files)) {
    const filename = path.join(output, relative);
    fs.utimesSync(filename, new Date(1000), new Date(1000));
    mtimes[relative] = fs.statSync(filename).mtimeMs;
  }
  assert.deepEqual(writePointerOverlay(rn, output), files);
  for (const [relative, mtime] of Object.entries(mtimes))
    assert.equal(fs.statSync(path.join(output, relative)).mtimeMs, mtime);
  fs.appendFileSync(path.join(output, base + '.cpp'), '// corrupt generated output');
  writePointerOverlay(rn, output);
  assert.equal(fs.readFileSync(path.join(output, base + '.cpp'), 'utf8'), files[base + '.cpp']);
});

test('the overlay changes native lifetime boundaries without replacing upstream capture negotiation', () => {
  const files = renderPointerOverlay(read('h'), read('cpp'), readBinding('h'), readBinding('cpp'));
  const source = files[base + '.cpp'];
  // These complete public method bodies determine immediate queries, wrong-owner
  // release, inactive IDs and the next-event pending/active algorithm.
  const start = read('cpp').indexOf('void PointerEventsProcessor::setPointerCapture(');
  const end = read('cpp').indexOf('ActivePointer* PointerEventsProcessor::getActivePointer(');
  assert.ok(source.includes(read('cpp').slice(start, end)), 'keep original public capture behavior');
  for (const type of ['topLostPointerCapture', 'topGotPointerCapture'])
    assert.match(source, new RegExp('retargeted\\.target && shouldEmitPointerEvent\\(\\s*\\*retargeted\\.target, "' + type + '"'));
  assert.match(source, /if \(!latestNodeToTarget\) return \{\};/);
  assert.match(source, /if \(retargeted\.target\) \{/);
  assert.match(source, /if \(!\*lifetime\) throw GodotPointerRetired\{\};/);
  assert.match(source, /catch \(const GodotPointerRetired &\)/);
  // By-value processor layout must always use the overlaid declaration, even
  // when this original header is reached through a quoted local include.
  assert.equal(files[bindingBase + '.h'], readBinding('h'));
  assert.match(files[bindingBase + '.h'], /#include <react\/renderer\/uimanager\/PointerEventsProcessor.h>/);
  assert.ok(!files[bindingBase + '.cpp'].includes('if (targetNode != nullptr) {'));
  assert.match(source, /if \(!targetNode && type == "topPointerDown"\) return;/);
  assert.match(source, /!targetNode \|\| overrideTarget->getTag\(\) != targetNode->getTag\(\)/);
});
