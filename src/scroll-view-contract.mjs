import {listOnlyProps} from "./list-props.mjs";
import {checkProps} from "./prop-scope.mjs";

// What the public ScrollView takes of RN's ScrollViewProps. Which props are honored, ignored or refused (and the one request of a
// refused prop that passes) is decided once per prop in src/prop-scope.mjs, which the check below runs first; what stays here
// is the checking of the values of the props the host does honor, and the props of the lists that the host would not know.
export function prepareScrollViewProps(props) {
  checkProps("ScrollView", props);
  if (props.contentOffset != null) {
    const offset = props.contentOffset;
    if (typeof offset !== "object" || Array.isArray(offset))
      throw new Error("Godot ScrollView contentOffset requires an object with finite x/y coordinates");
    const x = offset.x ?? 0;
    const y = offset.y ?? 0;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("Godot ScrollView contentOffset requires finite x/y coordinates");
  }
  if (props.scrollEventThrottle != null &&
      (!Number.isFinite(props.scrollEventThrottle) || props.scrollEventThrottle < 0))
    throw new Error("Godot ScrollView scrollEventThrottle requires a finite non-negative number");

  const forwarded = {...props};
  // Original lists pass their own props through the ScrollView boundary.
  for (const name of listOnlyProps) delete forwarded[name];
  delete forwarded.isInvertedVirtualizedList;
  delete forwarded.onRefresh;
  delete forwarded.refreshing;
  return forwarded;
}
