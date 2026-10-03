import type {ColorValue, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

export interface NativeProps extends ViewProps {
  tint?: ColorValue;
}

// RN Codegen supports ColorValue, but this spike deliberately has no Godot
// color-conversion contract. It must diagnose it instead of omitting tint.
export default codegenNativeComponent<NativeProps>('UnsupportedBadge');
