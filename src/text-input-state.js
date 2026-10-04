import TextInputState from "react-native/Libraries/Components/TextInput/TextInputState";
import codegenNativeCommands from "react-native/Libraries/Utilities/codegenNativeCommands";
import Platform from "./platform";

// Keep RN's original registry and focused-instance singleton. Its platform
// dispatch currently selects only iOS/Android; Godot supplies that last step.
const Commands = codegenNativeCommands({ supportedCommands: ["focus", "blur"] });
const focusTextInput = TextInputState.focusTextInput;
const blurTextInput = TextInputState.blurTextInput;
TextInputState.focusTextInput = (field) => {
  const before = TextInputState.currentlyFocusedInput();
  focusTextInput(field);
  if (Platform.OS === "godot" && field != null && before !== field &&
      TextInputState.currentlyFocusedInput() === field)
    Commands.focus(field);
};
TextInputState.blurTextInput = (field) => {
  const before = TextInputState.currentlyFocusedInput();
  blurTextInput(field);
  if (Platform.OS === "godot" && field != null && before === field &&
      TextInputState.currentlyFocusedInput() === null)
    Commands.blur(field);
};

export default TextInputState;
