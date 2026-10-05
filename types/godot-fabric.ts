/** Experimental D03–D08 game-service transport; final public signatures are not frozen. */
export type GodotDTO = null | boolean | number | string | GodotDTO[] | { [key: string]: GodotDTO };
export type ServiceAddress = string | { origin: string; name: string };
export interface ServiceAcknowledgement {
  readonly origin: string;
  readonly name: string;
  /** Decimal registration generation, distinct from a Godot ObjectID. */
  readonly generation: string;
  readonly revision: number;
}
export interface ServiceSnapshot<T> extends ServiceAcknowledgement { readonly value: T }
export interface ServiceCallResult<T> {
  readonly origin: string;
  readonly name: string;
  readonly generation: string;
  readonly response: "completion" | "acceptance";
  readonly value: T;
}
export interface ServiceSubscription<T> {
  readonly ready: Promise<T>;
  /** Idempotent; queued deliveries cannot invoke the removed handler. */
  remove(): void;
}
export declare const GodotFabric: {
  /** A string addresses the literal service name under origin "default". */
  subscribe<Args extends GodotDTO[] = GodotDTO[]>(address: ServiceAddress,
    handler: (...args: Args) => void): ServiceSubscription<ServiceAcknowledgement>;
  /** The initial snapshot is delivered once before newer revisions of that generation. */
  connect<T>(address: ServiceAddress,
    handler: (snapshot: ServiceSnapshot<T>) => void): ServiceSubscription<ServiceSnapshot<T>>;
  /** Values cross as strict JSON DTOs; a result may acknowledge acceptance rather than completion. */
  call<T>(address: ServiceAddress, args: readonly GodotDTO[]): Promise<ServiceCallResult<T>>;
};
