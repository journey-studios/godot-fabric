import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';
import type {EventEmitter, Int32} from 'react-native/Libraries/Types/CodegenTypes';
type ProbeResult = Readonly<{label: string; value: number}>;
export interface Spec extends TurboModule {
  readonly onResult: EventEmitter<ProbeResult>;
  add(left: number, right: number): number;
  describe(label: string): Promise<ProbeResult>;
  getStats(): string;
  fireCaptured(index: Int32, offThread: boolean): boolean;
  reset(): void;
}
export default TurboModuleRegistry.getEnforcing<Spec>('ExternalProbe');
