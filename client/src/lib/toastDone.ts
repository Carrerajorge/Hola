/**
 * Pill-style "task done" toast with ding sound
 * Minimal, auto-dismissing notification for completed tasks
 */
import { toast } from "@/lib/notify";
import { playDing } from "./notification-sound";

export function toastDone(msg = "Tarea completada"): void {
  playDing();
  toast(msg, {
    duration: 3000,
    className: "iliagpt-toast-done",
    unstyled: true,
  });
}
