import { toast as sonnerToast } from "sonner"

import {
  clearAllNotificationBursts,
  clearNotificationBurstById,
  formatRepeatedDescription,
  registerNotificationBurst,
} from "@/lib/notificationDeduper"

type SonnerMessage = Parameters<typeof sonnerToast>[0]
type SonnerOptions = Parameters<typeof sonnerToast>[1]
type CalmToastOptions = SonnerOptions & {
  dedupeKey?: string
  dedupeWindowMs?: number
}

let count = 0

function nextToastId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return `sonner-${count}`
}

function emitToast(
  tone: "message" | "success" | "error" | "warning" | "info" | "loading",
  emitter: (message: SonnerMessage, options?: SonnerOptions) => string | number,
  message: SonnerMessage,
  options?: CalmToastOptions,
) {
  const {
    dedupeKey,
    dedupeWindowMs,
    id: explicitId,
    description,
    ...rest
  } = options ?? {}

  const burst = registerNotificationBurst({
    source: "sonner",
    tone,
    title: message,
    description,
    dedupeKey,
    dedupeWindowMs,
    explicitId,
    createId: nextToastId,
  })

  return emitter(message, {
    ...rest,
    description: formatRepeatedDescription(description, burst.count),
    id: burst.id,
  })
}

const toast = Object.assign(
  (message: SonnerMessage, options?: CalmToastOptions) =>
    emitToast("message", sonnerToast, message, options),
  {
    success: (message: SonnerMessage, options?: CalmToastOptions) =>
      emitToast("success", sonnerToast.success, message, options),
    error: (message: SonnerMessage, options?: CalmToastOptions) =>
      emitToast("error", sonnerToast.error, message, options),
    warning: (message: SonnerMessage, options?: CalmToastOptions) =>
      emitToast("warning", sonnerToast.warning, message, options),
    info: (message: SonnerMessage, options?: CalmToastOptions) =>
      emitToast("info", sonnerToast.info, message, options),
    loading: (message: SonnerMessage, options?: CalmToastOptions) =>
      emitToast("loading", sonnerToast.loading, message, options),
    dismiss: (id?: string | number) => {
      if (typeof id === "undefined") {
        clearAllNotificationBursts()
      } else {
        clearNotificationBurstById(id)
      }
      return sonnerToast.dismiss(id)
    },
    promise: sonnerToast.promise,
    custom: sonnerToast.custom,
  },
)

export { toast }
