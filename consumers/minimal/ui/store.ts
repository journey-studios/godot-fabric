const listeners = new Set<() => void>();
let value = 0;
export const readShared = () => value;
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publish() {
  value++;
  for (const listener of listeners) listener();
}
