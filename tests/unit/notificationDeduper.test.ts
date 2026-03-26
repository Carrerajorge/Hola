import { afterEach, describe, expect, it, vi } from "vitest"

import {
  clearAllNotificationBursts,
  clearNotificationBurstById,
  formatRepeatedDescription,
  registerNotificationBurst,
} from "@/lib/notificationDeduper"

describe("notificationDeduper", () => {
  afterEach(() => {
    clearAllNotificationBursts()
    vi.useRealTimers()
  })

  it("reuses the same id for repeated bursts inside the calm window", () => {
    vi.useFakeTimers()

    const first = registerNotificationBurst({
      source: "sonner",
      tone: "success",
      title: "Copiado",
      description: "Contenido copiado",
      createId: () => "toast-1",
    })

    vi.advanceTimersByTime(2_000)

    const second = registerNotificationBurst({
      source: "sonner",
      tone: "success",
      title: "Copiado",
      description: "Contenido copiado",
      createId: () => "toast-2",
    })

    expect(first).toMatchObject({
      id: "toast-1",
      count: 1,
      isBurst: false,
    })
    expect(second).toMatchObject({
      id: "toast-1",
      count: 2,
      isBurst: true,
    })
  })

  it("creates a fresh id after the dedupe window passes", () => {
    vi.useFakeTimers()

    const first = registerNotificationBurst({
      source: "radix",
      tone: "default",
      title: "Guardado",
      description: "Tus cambios fueron aplicados.",
      createId: () => "toast-1",
    })

    vi.advanceTimersByTime(8_100)

    const second = registerNotificationBurst({
      source: "radix",
      tone: "default",
      title: "Guardado",
      description: "Tus cambios fueron aplicados.",
      createId: () => "toast-2",
    })

    expect(first.id).toBe("toast-1")
    expect(second).toMatchObject({
      id: "toast-2",
      count: 1,
      isBurst: false,
    })
  })

  it("clears tracked bursts when a toast is dismissed", () => {
    const first = registerNotificationBurst({
      source: "sonner",
      tone: "error",
      title: "Error al conectar",
      description: "Vuelve a intentarlo.",
      createId: () => "toast-1",
    })

    clearNotificationBurstById(first.id)

    const second = registerNotificationBurst({
      source: "sonner",
      tone: "error",
      title: "Error al conectar",
      description: "Vuelve a intentarlo.",
      createId: () => "toast-2",
    })

    expect(second.id).toBe("toast-2")
    expect(second.isBurst).toBe(false)
  })

  it("adds a subtle repeat label to the description", () => {
    expect(formatRepeatedDescription("Contenido copiado", 3)).toBe(
      "Contenido copiado · Repetido 3 veces",
    )
    expect(formatRepeatedDescription(undefined, 2)).toBe("Repetido 2 veces")
  })
})
