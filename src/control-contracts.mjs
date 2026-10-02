const buttonProps = new Set(["ref", "title", "onPress", "disabled", "color", "testID"]);
const inputProps = new Set(["ref", "value", "defaultValue", "selection", "editable", "placeholder",
  "submitBehavior", "multiline", "autoFocus", "style", "testID", "onLayout", "onChange", "onChangeText",
  "onSelectionChange", "onFocus", "onBlur", "onEndEditing", "onSubmitEditing", "onKeyPress"]);

function supported(props, names, kind) {
  for (const name of Object.keys(props)) {
    if (props[name] === undefined) continue;
    if (!names.has(name)) throw new Error(`Godot ${kind} does not implement prop ${name}`);
    if (name.startsWith("on") && typeof props[name] !== "function")
      throw new Error(`${kind} ${name} must be a function`);
  }
  for (const name of ["disabled", "editable", "multiline", "autoFocus"])
    if (props[name] !== undefined && typeof props[name] !== "boolean")
      throw new Error(`${kind} ${name} must be a boolean`);
  if (props.testID !== undefined && typeof props.testID !== "string")
    throw new Error(`${kind} testID must be a string`);
}
export function validateButton(props) {
  supported(props, buttonProps, "Button");
  if (typeof props.title !== "string") throw new Error("Button title must be a string");
  if (props.color !== undefined && typeof props.color !== "string")
    throw new Error("Godot Button color currently requires a static color string");
}
export function validateInput(props) {
  supported(props, inputProps, "TextInput");
  if (props.multiline) throw new Error("Godot TextInput supports one line; multiline is not implemented");
  if (props.submitBehavior !== undefined && !["submit", "blurAndSubmit"].includes(props.submitBehavior))
    throw new Error("Godot TextInput supports submit or blurAndSubmit");
  for (const name of ["value", "defaultValue", "placeholder"]) {
    if (props[name] === undefined) continue;
    if (typeof props[name] !== "string") throw new Error(`TextInput ${name} must be a string`);
    if (/[\r\n]/.test(props[name])) throw new Error(`Single-line TextInput ${name} cannot contain a newline`);
  }
  if (props.selection !== undefined) {
    if (props.selection === null || typeof props.selection !== "object")
      throw new Error("TextInput selection requires ordered nonnegative UTF-16 offsets");
    validateSelection(props.selection.start, props.selection.end ?? props.selection.start);
  }
}
export function validateSelection(start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start)
    throw new Error("TextInput selection requires ordered nonnegative UTF-16 offsets");
}
