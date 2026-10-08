import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

// native/text_platform/ is RN's portable `cxx` TextLayoutManager plus the virtual measureLines that
// ParagraphShadowNode and TextLayoutManagerExtended look for. A copy can drift silently from the
// pinned RN when the pin moves, so this guard compares it to the pinned files with the documented
// additions removed, block by block. Static: no Godot, no build.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reactCommon = path.join(root, 'node_modules/react-native/ReactCommon');
const directory = 'react/renderer/textlayoutmanager';
const pinned = file => path.join(reactCommon, directory, 'platform/cxx', directory, file);
const ours = file => path.join(root, 'native/text_platform', directory, file);
const read = file => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const update = file => `Update native/text_platform/${directory}/${file} from the pinned RN's ReactCommon/${directory}/platform/cxx/${directory}/${file}, then re-apply the documented additions`;

// The additions, each removed from our copy by its exact text.
const sizeInclude = '#include <react/renderer/graphics/Size.h>\n';
const declaration = `
  /*
   * Reports the lines of \`attributedString\` laid out in \`size\`, in the
   * LineMeasurement format of RN's iOS/Android managers. The portable default
   * has no text engine and reports no lines.
   */
  virtual LinesMeasurements measureLines(
      const AttributedStringBox &attributedStringBox,
      const ParagraphAttributes &paragraphAttributes,
      const Size &size) const;
`;
const definition = `LinesMeasurements TextLayoutManager::measureLines(
    const AttributedStringBox& /*attributedStringBox*/,
    const ParagraphAttributes& /*paragraphAttributes*/,
    const Size& /*size*/) const {
  return {};
}

`;
// The first block comment is the file's header: ours says what the file is and keeps the Meta notice.
const header = /^\/\*[\s\S]*?\*\/\n/;

function without(text, block, name, file) {
  assert.equal(text.split(block).length, 2, `${file}: the documented ${name} must be present exactly once. ${update(file)}`);
  return text.replace(block, () => '');
}

// What is left of our copy once the documented additions are taken out: it must be the pinned file.
// The .cpp keeps the pinned header as it is; the .h replaces its header comment, so that is compared apart.
function stripped(file, source) {
  let text = source;
  if (file.endsWith('.h')) {
    const head = text.match(header)?.[0] ?? '';
    assert.match(head, /Godot platform TextLayoutManager/, `${file}: the header comment says what the file is`);
    assert.match(head, /Copyright \(c\) Meta Platforms, Inc\. and affiliates/, `${file}: the Meta notice is kept`);
    assert.match(head, /MIT license/, `${file}: the MIT license is named`);
    text = without(without(text.replace(header, () => ''), sizeInclude, 'include of Size.h', file), declaration,
      'measureLines declaration', file);
  } else {
    text = without(text, definition, 'default measureLines definition', file);
  }
  return text;
}

function original(file) {
  const text = read(pinned(file));
  return file.endsWith('.h') ? text.replace(header, () => '') : text;
}

function drift(file, source = read(ours(file))) {
  const expected = original(file).split('\n'), actual = stripped(file, source).split('\n');
  const line = expected.findIndex((text, index) => text !== actual[index]);
  return line < 0 && expected.length === actual.length ? null : `${file}: line ${line < 0 ? expected.length + 1 : line + 1} differs from the pinned RN. ${update(file)}`;
}

for (const file of ['TextLayoutManager.h', 'TextLayoutManager.cpp']) {
  test(`the Godot platform ${file} is RN's portable one plus the documented measureLines additions`, () => {
    assert.equal(drift(file), null);
  });
}

test('any other difference from the pinned manager fails and says to update the copy', () => {
  const file = 'TextLayoutManager.h';
  const drifted = read(ours(file)).replace('virtual TextMeasurement measure(', 'virtual TextMeasurement measureOnce(');
  assert.match(drift(file, drifted) ?? '', /differs from the pinned RN\. Update native\/text_platform\/.*from the pinned RN's ReactCommon/);
  assert.throws(() => drift(file, read(ours(file)).replace(sizeInclude, '')), /Size\.h must be present exactly once/);
});

test('the declaration still matches what RN calls: supportsLineMeasurement, layout and baseline', () => {
  const extended = read(path.join(reactCommon, directory, 'TextLayoutManagerExtended.h'));
  assert.ok(extended.includes('textLayoutManager.measureLines(AttributedStringBox{}, ParagraphAttributes{}, Size{})'),
    'TextLayoutManagerExtended probes measureLines(AttributedStringBox, ParagraphAttributes, Size)');
  assert.ok(extended.includes('} -> std::same_as<LinesMeasurements>;'), 'and requires the LinesMeasurements return type');
  const paragraph = read(path.join(reactCommon, 'react/renderer/components/text/ParagraphShadowNode.cpp'));
  const calls = paragraph.match(/\.measureLines\(\s*attributedStringBox, content\.paragraphAttributes, size\)/g) ?? [];
  assert.equal(calls.length, 2, 'ParagraphShadowNode asks for the lines in baseline() and in layout()');
  assert.ok(paragraph.includes('LineMeasurement::baseline(lines)'), 'and takes the baseline from the first line');
  const header = read(ours('TextLayoutManager.h'));
  assert.ok(header.includes('virtual LinesMeasurements measureLines(') && header.includes('const Size &size) const;'),
    'our measureLines has that signature, virtual and const, so the Godot host can override it');
});
