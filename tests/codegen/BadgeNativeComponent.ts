import type {HostComponent, ViewProps} from 'react-native';
import type {
  DirectEventHandler,
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';

type ActivateEvent = Readonly<{count: Int32; label: string}>;

export interface NativeProps extends ViewProps {
  caption?: WithDefault<string, ''>;
  enabled?: WithDefault<boolean, true>;
  count?: WithDefault<Int32, 0>;
  onActivate?: DirectEventHandler<ActivateEvent>;
}

interface NativeCommands {
  focus: (viewRef: React.ElementRef<HostComponent<NativeProps>>) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['focus'],
});

export default codegenNativeComponent<NativeProps>('CodegenBadge');
