import type * as React from 'react';
import type {HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';
import type {DirectEventHandler, Int32, WithDefault} from 'react-native/Libraries/Types/CodegenTypes';

type Activate = Readonly<{count: Int32; label: string}>;
export interface NativeProps extends ViewProps {
  caption?: WithDefault<string, ''>;
  enabled?: WithDefault<boolean, true>;
  count?: WithDefault<Int32, 0>;
  onBadgeActivate?: DirectEventHandler<Activate>;
}
type NativeType = HostComponent<NativeProps>;
interface NativeCommands {focus: (viewRef: React.ElementRef<NativeType>) => void;}
export const Commands = codegenNativeCommands<NativeCommands>({supportedCommands: ['focus']});
export default codegenNativeComponent<NativeProps>('ExternalBadge');
