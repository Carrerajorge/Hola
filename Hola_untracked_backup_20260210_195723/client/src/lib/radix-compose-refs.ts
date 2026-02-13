import * as React from "react";

// Workaround: React 19 + Radix can trigger "Maximum update depth exceeded"
// via ref callback churn inside FocusScope/Menu primitives. The upstream
// implementation memoizes the composed ref callback with the refs array as
// dependencies, so any inline ref function forces a new callback every render,
// which in turn makes React call oldRef(null) + newRef(node) repeatedly.
//
// We keep the callback identity stable and read the latest refs from a ref.
// This avoids the ref "thrash" while preserving the basic semantics needed by
// Radix components in this app.

type AnyRef<T> =
  | ((instance: T | null) => void | (() => void))
  | React.MutableRefObject<T | null>
  | null
  | undefined;

function setRef<T>(ref: AnyRef<T>, value: T | null) {
  if (typeof ref === "function") return ref(value);
  if (ref != null) (ref as React.MutableRefObject<T | null>).current = value;
}

export function composeRefs<T>(...refs: AnyRef<T>[]) {
  return (node: T | null) => {
    let hasCleanup = false;
    const cleanups = refs.map((ref) => {
      const cleanup = setRef(ref, node);
      if (!hasCleanup && typeof cleanup === "function") hasCleanup = true;
      return cleanup;
    });

    if (hasCleanup) {
      return () => {
        for (let i = 0; i < cleanups.length; i++) {
          const cleanup = cleanups[i];
          if (typeof cleanup === "function") cleanup();
          else setRef(refs[i], null);
        }
      };
    }
  };
}

export function useComposedRefs<T>(...refs: AnyRef<T>[]) {
  const refsRef = React.useRef(refs);
  refsRef.current = refs;

  return React.useCallback((node: T | null) => {
    const currentRefs = refsRef.current;
    let hasCleanup = false;
    const cleanups = currentRefs.map((ref) => {
      const cleanup = setRef(ref, node);
      if (!hasCleanup && typeof cleanup === "function") hasCleanup = true;
      return cleanup;
    });

    if (hasCleanup) {
      return () => {
        for (let i = 0; i < cleanups.length; i++) {
          const cleanup = cleanups[i];
          if (typeof cleanup === "function") cleanup();
          else setRef(currentRefs[i], null);
        }
      };
    }
  }, []);
}

