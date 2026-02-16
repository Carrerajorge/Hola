"use client";

// Patched fork of `@radix-ui/react-dismissable-layer` for React 19.
//
// Upstream uses an inline ref callback `(node) => setNode(node)` inside
// `useComposedRefs`, which changes identity every render and can trigger ref
// detach/attach cycles that call `setNode(null)`/`setNode(node)` repeatedly.
// With React 19 ref cleanup semantics, this can lead to "Maximum update depth
// exceeded" in DropdownMenu/Popover/Dialog trees.
//
// Fix: pass the stable state setter `setNode` directly.

import * as React from "react";
import { composeEventHandlers } from "@radix-ui/primitive";
import { Primitive, dispatchDiscreteCustomEvent } from "@radix-ui/react-primitive";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { useCallbackRef } from "@radix-ui/react-use-callback-ref";
import { useEscapeKeydown } from "@radix-ui/react-use-escape-keydown";
import { jsx } from "react/jsx-runtime";

const DISMISSABLE_LAYER_NAME = "DismissableLayer";
const CONTEXT_UPDATE = "dismissableLayer.update";
const POINTER_DOWN_OUTSIDE = "dismissableLayer.pointerDownOutside";
const FOCUS_OUTSIDE = "dismissableLayer.focusOutside";

let originalBodyPointerEvents: string | undefined;

const DismissableLayerContext = React.createContext({
  layers: new Set<HTMLElement>(),
  layersWithOutsidePointerEventsDisabled: new Set<HTMLElement>(),
  branches: new Set<HTMLElement>(),
});

export const DismissableLayer = React.forwardRef<
  React.ElementRef<typeof Primitive.div>,
  React.ComponentPropsWithoutRef<typeof Primitive.div> & {
    disableOutsidePointerEvents?: boolean;
    onEscapeKeyDown?: (event: KeyboardEvent) => void;
    onPointerDownOutside?: (event: CustomEvent<{ originalEvent: PointerEvent }>) => void;
    onFocusOutside?: (event: CustomEvent<{ originalEvent: FocusEvent }>) => void;
    onInteractOutside?: (event: CustomEvent<{ originalEvent: Event }>) => void;
    onDismiss?: () => void;
  }
>((props, forwardedRef) => {
  const {
    disableOutsidePointerEvents = false,
    onEscapeKeyDown,
    onPointerDownOutside,
    onFocusOutside,
    onInteractOutside,
    onDismiss,
    ...layerProps
  } = props;

  const context = React.useContext(DismissableLayerContext);
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const ownerDocument = node?.ownerDocument ?? globalThis?.document;
  const [, force] = React.useState({});

  // IMPORTANT: setNode is stable; avoid inline ref callback churn.
  const composedRefs = useComposedRefs(forwardedRef, setNode);

  const layers = Array.from(context.layers);
  const [highestLayerWithOutsidePointerEventsDisabled] = [...context.layersWithOutsidePointerEventsDisabled].slice(-1);
  const highestLayerWithOutsidePointerEventsDisabledIndex = layers.indexOf(highestLayerWithOutsidePointerEventsDisabled as any);
  const index = node ? layers.indexOf(node) : -1;
  const isBodyPointerEventsDisabled = context.layersWithOutsidePointerEventsDisabled.size > 0;
  const isPointerEventsEnabled = index >= highestLayerWithOutsidePointerEventsDisabledIndex;

  const pointerDownOutside = usePointerDownOutside((event) => {
    const target = event.target as HTMLElement;
    const isPointerDownOnBranch = [...context.branches].some((branch) => branch.contains(target));
    if (!isPointerEventsEnabled || isPointerDownOnBranch) return;
    onPointerDownOutside?.(event as any);
    onInteractOutside?.(event as any);
    if (!event.defaultPrevented) onDismiss?.();
  }, ownerDocument);

  const focusOutside = useFocusOutside((event) => {
    const target = event.target as HTMLElement;
    const isFocusInBranch = [...context.branches].some((branch) => branch.contains(target));
    if (isFocusInBranch) return;
    onFocusOutside?.(event as any);
    onInteractOutside?.(event as any);
    if (!event.defaultPrevented) onDismiss?.();
  }, ownerDocument);

  useEscapeKeydown((event) => {
    const isHighestLayer = index === context.layers.size - 1;
    if (!isHighestLayer) return;
    onEscapeKeyDown?.(event);
    if (!event.defaultPrevented && onDismiss) {
      event.preventDefault();
      onDismiss();
    }
  }, ownerDocument);

  React.useEffect(() => {
    if (!node) return;
    if (disableOutsidePointerEvents) {
      if (context.layersWithOutsidePointerEventsDisabled.size === 0) {
        originalBodyPointerEvents = ownerDocument?.body?.style?.pointerEvents;
        if (ownerDocument?.body) ownerDocument.body.style.pointerEvents = "none";
      }
      context.layersWithOutsidePointerEventsDisabled.add(node);
    }

    context.layers.add(node);
    dispatchUpdate();

    return () => {
      if (disableOutsidePointerEvents && context.layersWithOutsidePointerEventsDisabled.size === 1) {
        if (ownerDocument?.body) ownerDocument.body.style.pointerEvents = originalBodyPointerEvents || "";
      }
    };
  }, [node, ownerDocument, disableOutsidePointerEvents, context]);

  React.useEffect(() => {
    return () => {
      if (!node) return;
      context.layers.delete(node);
      context.layersWithOutsidePointerEventsDisabled.delete(node);
      dispatchUpdate();
    };
  }, [node, context]);

  React.useEffect(() => {
    const handleUpdate = () => force({});
    document.addEventListener(CONTEXT_UPDATE, handleUpdate);
    return () => document.removeEventListener(CONTEXT_UPDATE, handleUpdate);
  }, []);

  return jsx(Primitive.div, {
    ...layerProps,
    ref: composedRefs as any,
    style: {
      pointerEvents: isBodyPointerEventsDisabled ? (isPointerEventsEnabled ? "auto" : "none") : void 0,
      ...props.style,
    },
    onFocusCapture: composeEventHandlers((props as any).onFocusCapture, focusOutside.onFocusCapture),
    onBlurCapture: composeEventHandlers((props as any).onBlurCapture, focusOutside.onBlurCapture),
    onPointerDownCapture: composeEventHandlers(
      (props as any).onPointerDownCapture,
      pointerDownOutside.onPointerDownCapture,
    ),
  });
});

DismissableLayer.displayName = DISMISSABLE_LAYER_NAME;

const BRANCH_NAME = "DismissableLayerBranch";

export const DismissableLayerBranch = React.forwardRef<
  React.ElementRef<typeof Primitive.div>,
  React.ComponentPropsWithoutRef<typeof Primitive.div>
>((props, forwardedRef) => {
  const context = React.useContext(DismissableLayerContext);
  const ref = React.useRef<HTMLElement | null>(null);
  const composedRefs = useComposedRefs(forwardedRef, ref);

  React.useEffect(() => {
    const node = ref.current;
    if (node) {
      context.branches.add(node);
      return () => {
        context.branches.delete(node);
      };
    }
  }, [context]);

  return jsx(Primitive.div, { ...props, ref: composedRefs as any });
});

DismissableLayerBranch.displayName = BRANCH_NAME;

function usePointerDownOutside(
  onPointerDownOutside: ((event: PointerEvent) => void) | undefined,
  ownerDocument: Document = globalThis?.document as Document,
) {
  const handlePointerDownOutside = useCallbackRef(onPointerDownOutside);
  const isPointerInsideReactTreeRef = React.useRef(false);
  const handleClickRef = React.useRef<((event: MouseEvent) => void) | null>(null);

  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target && !isPointerInsideReactTreeRef.current) {
        const eventDetail = { originalEvent: event };
        const handleAndDispatchPointerDownOutsideEvent = () => {
          handleAndDispatchCustomEvent(
            POINTER_DOWN_OUTSIDE,
            handlePointerDownOutside,
            eventDetail,
            { discrete: true },
          );
        };

        if (event.pointerType === "touch") {
          ownerDocument.removeEventListener("click", handleClickRef.current as any);
          handleClickRef.current = handleAndDispatchPointerDownOutsideEvent;
          ownerDocument.addEventListener("click", handleClickRef.current as any, { once: true });
        } else {
          handleAndDispatchPointerDownOutsideEvent();
        }
      } else {
        ownerDocument.removeEventListener("click", handleClickRef.current as any);
      }
      isPointerInsideReactTreeRef.current = false;
    };

    const timerId = window.setTimeout(() => {
      ownerDocument.addEventListener("pointerdown", handlePointerDown);
    }, 0);

    return () => {
      window.clearTimeout(timerId);
      ownerDocument.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("click", handleClickRef.current as any);
    };
  }, [ownerDocument, handlePointerDownOutside]);

  return {
    onPointerDownCapture: () => (isPointerInsideReactTreeRef.current = true),
  };
}

function useFocusOutside(
  onFocusOutside: ((event: FocusEvent) => void) | undefined,
  ownerDocument: Document = globalThis?.document as Document,
) {
  const handleFocusOutside = useCallbackRef(onFocusOutside);
  const isFocusInsideReactTreeRef = React.useRef(false);

  React.useEffect(() => {
    const handleFocus = (event: FocusEvent) => {
      if (event.target && !isFocusInsideReactTreeRef.current) {
        const eventDetail = { originalEvent: event };
        handleAndDispatchCustomEvent(FOCUS_OUTSIDE, handleFocusOutside, eventDetail, {
          discrete: false,
        });
      }
    };

    ownerDocument.addEventListener("focusin", handleFocus);
    return () => ownerDocument.removeEventListener("focusin", handleFocus);
  }, [ownerDocument, handleFocusOutside]);

  return {
    onFocusCapture: () => (isFocusInsideReactTreeRef.current = true),
    onBlurCapture: () => (isFocusInsideReactTreeRef.current = false),
  };
}

function dispatchUpdate() {
  const event = new CustomEvent(CONTEXT_UPDATE);
  document.dispatchEvent(event);
}

function handleAndDispatchCustomEvent(
  name: string,
  handler: any,
  detail: any,
  { discrete }: { discrete: boolean },
) {
  const target = detail.originalEvent.target as HTMLElement;
  const event = new CustomEvent(name, { bubbles: false, cancelable: true, detail });
  if (handler) target.addEventListener(name, handler, { once: true });
  if (discrete) {
    dispatchDiscreteCustomEvent(target, event);
  } else {
    target.dispatchEvent(event);
  }
}

export const Root = DismissableLayer;
export const Branch = DismissableLayerBranch;

