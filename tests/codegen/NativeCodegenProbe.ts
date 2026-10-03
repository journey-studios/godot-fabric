import type {TurboModule} from 'react-native';
import type {EventEmitter} from 'react-native/Libraries/Types/CodegenTypes';
import {TurboModuleRegistry} from 'react-native';

export type ProbeResult = Readonly<{label: string; value: number}>;

export interface Spec extends TurboModule {
  readonly onResult: EventEmitter<ProbeResult>;
  add(left: number, right: number): number;
  describe(label: string): Promise<ProbeResult>;
  reset(): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('CodegenProbe');
