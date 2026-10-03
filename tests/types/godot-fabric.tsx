import { GodotFabric, type ServiceSnapshot, type ServiceCallResult } from "@godot-fabric/runtime";

interface Health { hp: number; max: number }
const health = GodotFabric.connect<Health>({ origin: "player", name: "health" }, snapshot => {
  const hp: number = snapshot.value.hp;
  const generation: string = snapshot.generation;
  const revision: number = snapshot.revision;
  void [hp, generation, revision];
  // @ts-expect-error the selected state type has no inventory field
  snapshot.value.inventory;
});
const initial: Promise<ServiceSnapshot<Health>> = health.ready;
health.remove(); health.remove();
const signal = GodotFabric.subscribe<[string, number]>("item.picked", (item, count) => {
  const label: string = item;
  const amount: number = count;
  void [label, amount];
  // @ts-expect-error a numeric argument remains numeric
  const invalid: string = count;
  void invalid;
});
const command: Promise<ServiceCallResult<{ equipped: boolean }>> = GodotFabric.call("equip", ["sword", { slot: 2 }]);
void [initial, signal.ready, command];
// @ts-expect-error origin is required in an explicit address
GodotFabric.call({ name: "equip" }, []);
// @ts-expect-error args are an array, not an arbitrary DTO
GodotFabric.call("equip", { slot: 2 });
// @ts-expect-error functions are not transport DTOs
GodotFabric.call("equip", [() => {}]);
// @ts-expect-error dates are not transport DTOs
GodotFabric.call("equip", [new Date()]);
// @ts-expect-error handlers are functions
GodotFabric.subscribe("hit", 1);
// @ts-expect-error signal argument tuples must contain transport DTOs
GodotFabric.subscribe<[() => void]>("hit", callback => callback());
