"use client";

// Patched fork of `@radix-ui/react-focus-scope` for React 19.
//
// In React 19, ref callbacks can cause "Maximum update depth exceeded" when the
// ref callback identity changes during re-renders (React will call oldRef(null)
// then newRef(node), and Radix stores the node in state). The upstream module
// currently passes an inline ref callback into `useComposedRefs`, which changes
// identity every render and can trigger a null/node state ping-pong.
//
// Fix: memoize the `setContainer` ref callback so `useComposedRefs` can stay
// stable across renders.

import * as React from "react";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { Primitive } from "@radix-ui/react-primitive";
import { useCallbackRef } from "@radix-ui/react-use-callback-ref";
import { jsx } from "react/jsx-runtime";

const AUTOFOCUS_ON_MOUNT = "focusScope.autoFocusOnMount";
const AUTOFOCUS_ON_UNMOUNT = "focusScope.autoFocusOnUnmount";
const EVENT_OPTIONS = { bubbles: false, cancelable: true } as const;
const FOCUS_SCOPE_NAME = "FocusScope";

export const FocusScope = React.forwardRef<
  React.ElementRef<typeof Primitive.div>,
  React.ComponentPropsWithoutRef<typeof Primitive.div> & {
    loop?: boolean;
    trapped?: boolean;
    onMountAutoFocus?: (event: Event) => void;
    onUnmountAutoFocus?: (event: Event) => void;
  }
>((props, forwardedRef) => {
  const {
    loop = false,
    trapped = false,
    onMountAutoFocus: onMountAutoFocusProp,
    onUnmountAutoFocus: onUnmountAutoFocusProp,
    ...scopeProps
  } = props;

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const onMountAutoFocus = useCallbackRef(onMountAutoFocusProp);
  const onUnmountAutoFocus = useCallbackRef(onUnmountAutoFocusProp);
  const lastFocusedElementRef = React.useRef<HTMLElement | null>(null);

  // IMPORTANT: keep this ref callback stable.
  const setContainerRef = React.useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node;
  }, []);

  const composedRefs = useComposedRefs(forwardedRef, setContainerRef);

  const focusScope = React.useRef({
    paused: false,
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
  }).current;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!trapped || !container) return;

    {
      function handleFocusIn(event: FocusEvent) {
        if (focusScope.paused || !container) return;
        const target = event.target as HTMLElement;
        if (container.contains(target)) {
          lastFocusedElementRef.current = target;
        } else {
          focus(lastFocusedElementRef.current, { select: true });
        }
      }

      function handleFocusOut(event: FocusEvent) {
        if (focusScope.paused || !container) return;
        const relatedTarget = event.relatedTarget as HTMLElement | null;
        if (relatedTarget === null) return;
        if (!container.contains(relatedTarget)) {
          focus(lastFocusedElementRef.current, { select: true });
        }
      }

      function handleMutations(mutations: MutationRecord[]) {
        const focusedElement = document.activeElement;
        if (focusedElement !== document.body) return;
        for (const mutation of mutations) {
          if (mutation.removedNodes.length > 0) focus(container);
        }
      }

      document.addEventListener("focusin", handleFocusIn);
      document.addEventListener("focusout", handleFocusOut);
      const mutationObserver = new MutationObserver(handleMutations);
      mutationObserver.observe(container, { childList: true, subtree: true });

      return () => {
        document.removeEventListener("focusin", handleFocusIn);
        document.removeEventListener("focusout", handleFocusOut);
        mutationObserver.disconnect();
      };
    }
  }, [trapped, focusScope]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    focusScopesStack.add(focusScope);
    const previouslyFocusedElement = document.activeElement as HTMLElement | null;
    const hasFocusedCandidate =
      previouslyFocusedElement ? container.contains(previouslyFocusedElement) : false;

    if (!hasFocusedCandidate) {
      const mountEvent = new CustomEvent(AUTOFOCUS_ON_MOUNT, EVENT_OPTIONS);
      container.addEventListener(AUTOFOCUS_ON_MOUNT, onMountAutoFocus as EventListener);
      container.dispatchEvent(mountEvent);
      if (!mountEvent.defaultPrevented) {
        focusFirst(removeLinks(getTabbableCandidates(container)), { select: true });
        if (document.activeElement === previouslyFocusedElement) {
          focus(container);
        }
      }
    }

    return () => {
      container.removeEventListener(AUTOFOCUS_ON_MOUNT, onMountAutoFocus as EventListener);
      setTimeout(() => {
        const unmountEvent = new CustomEvent(AUTOFOCUS_ON_UNMOUNT, EVENT_OPTIONS);
        container.addEventListener(AUTOFOCUS_ON_UNMOUNT, onUnmountAutoFocus as EventListener);
        container.dispatchEvent(unmountEvent);
        if (!unmountEvent.defaultPrevented) {
          focus(previouslyFocusedElement ?? document.body, { select: true });
        }
        container.removeEventListener(AUTOFOCUS_ON_UNMOUNT, onUnmountAutoFocus as EventListener);
        focusScopesStack.remove(focusScope);
      }, 0);
    };
  }, [onMountAutoFocus, onUnmountAutoFocus, focusScope]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      if (!loop && !trapped) return;
      if (focusScope.paused) return;

      const isTabKey = event.key === "Tab" && !event.altKey && !event.ctrlKey && !event.metaKey;
      const focusedElement = document.activeElement as HTMLElement | null;

      if (isTabKey && focusedElement) {
        const containerEl = event.currentTarget as HTMLElement;
        const [first, last] = getTabbableEdges(containerEl);
        const hasTabbableElementsInside = Boolean(first && last);

        if (!hasTabbableElementsInside) {
          if (focusedElement === containerEl) event.preventDefault();
        } else {
          if (!event.shiftKey && focusedElement === last) {
            event.preventDefault();
            if (loop && first) focus(first, { select: true });
          } else if (event.shiftKey && focusedElement === first) {
            event.preventDefault();
            if (loop && last) focus(last, { select: true });
          }
        }
      }
    },
    [loop, trapped, focusScope.paused],
  );

  return jsx(Primitive.div, { tabIndex: -1, ...scopeProps, ref: composedRefs, onKeyDown: handleKeyDown });
});

FocusScope.displayName = FOCUS_SCOPE_NAME;

function focusFirst(candidates: HTMLElement[], { select = false }: { select?: boolean } = {}) {
  const previouslyFocusedElement = document.activeElement as HTMLElement | null;
  for (const candidate of candidates) {
    focus(candidate, { select });
    if (document.activeElement !== previouslyFocusedElement) return;
  }
}

function getTabbableEdges(container: HTMLElement) {
  const candidates = getTabbableCandidates(container);
  const first = findVisible(candidates, container);
  const last = findVisible([...candidates].reverse(), container);
  return [first, last] as const;
}

function getTabbableCandidates(container: HTMLElement): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      const el = node as HTMLElement & { disabled?: boolean; hidden?: boolean; type?: string };
      const isHiddenInput = el.tagName === "INPUT" && (el as any).type === "hidden";
      if ((el as any).disabled || (el as any).hidden || isHiddenInput) return NodeFilter.FILTER_SKIP;
      return el.tabIndex >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  // eslint-disable-next-line no-cond-assign
  while (walker.nextNode()) nodes.push(walker.currentNode as HTMLElement);
  return nodes;
}

function findVisible(elements: HTMLElement[], container: HTMLElement) {
  for (const element of elements) {
    if (!isHidden(element, { upTo: container })) return element;
  }
  return null;
}

function isHidden(node: HTMLElement, { upTo }: { upTo?: HTMLElement }) {
  if (getComputedStyle(node).visibility === "hidden") return true;
  let el: HTMLElement | null = node;
  while (el) {
    if (upTo !== void 0 && el === upTo) return false;
    if (getComputedStyle(el).display === "none") return true;
    el = el.parentElement;
  }
  return false;
}

function isSelectableInput(element: unknown): element is HTMLInputElement {
  return element instanceof HTMLInputElement && "select" in element;
}

function focus(element: any, { select = false }: { select?: boolean } = {}) {
  if (element && element.focus) {
    const previouslyFocusedElement = document.activeElement;
    element.focus({ preventScroll: true });
    if (element !== previouslyFocusedElement && isSelectableInput(element) && select) {
      element.select();
    }
  }
}

const focusScopesStack = createFocusScopesStack();

function createFocusScopesStack() {
  let stack: any[] = [];
  return {
    add(focusScope: any) {
      const activeFocusScope = stack[0];
      if (focusScope !== activeFocusScope) {
        activeFocusScope?.pause();
      }
      stack = arrayRemove(stack, focusScope);
      stack.unshift(focusScope);
    },
    remove(focusScope: any) {
      stack = arrayRemove(stack, focusScope);
      stack[0]?.resume();
    },
  };
}

function arrayRemove(array: any[], item: any) {
  const updatedArray = [...array];
  const index = updatedArray.indexOf(item);
  if (index !== -1) {
    updatedArray.splice(index, 1);
  }
  return updatedArray;
}

function removeLinks(items: HTMLElement[]) {
  return items.filter((item) => item.tagName !== "A");
}

export const Root = FocusScope;
