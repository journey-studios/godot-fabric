import React, { useCallback, useLayoutEffect, useRef } from "react";
import { TextInput as NativeInput } from "./components";
import { validateSelection } from "./control-contracts.mjs";

// RN's stock TextInput selects only iOS/Android hosts. This Godot wrapper uses
// the already-tested native edit acknowledgement path, not another reconciler.
export function PublicInput({ ref, autoFocus = false, onChange, style, ...props }) {
  const native = useRef(null);
  const eventCount = useRef(0);
  const attach = useCallback((instance) => {
    native.current = instance;
    if (instance) Object.assign(instance, {
      clear() { native.current?.setTextAndSelection(eventCount.current, "", 0, 0); },
      getNativeRef() { return native.current; },
      setSelection(start, end) {
        validateSelection(start, end);
        native.current?.setTextAndSelection(eventCount.current, null, start, end);
      },
    });
    let cleanup;
    if (typeof ref === "function") cleanup = ref(instance);
    else if (ref) ref.current = instance;
    return () => {
      native.current = null;
      if (typeof cleanup === "function") cleanup();
      else if (typeof ref === "function") ref(null);
      else if (ref) ref.current = null;
    };
  }, [ref]);
  useLayoutEffect(() => { if (autoFocus) native.current?.focus(); }, []);
  return <NativeInput {...props} ref={attach} style={style} fontSize={style.fontSize ?? 18}
    color={style.color}
    onChange={(event) => {
      eventCount.current = event.nativeEvent.eventCount;
      onChange?.(event);
    }} />;
}
