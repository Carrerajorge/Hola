import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({
        id,
        title,
        description,
        action,
        repeatCount,
        dedupeKey: _dedupeKey,
        dedupeWindowMs: _dedupeWindowMs,
        ...props
      }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid min-w-0 flex-1 gap-0.5">
              {(title || (repeatCount ?? 0) > 1) && (
                <div className="flex items-start gap-2">
                  {title && <ToastTitle className="min-w-0 flex-1">{title}</ToastTitle>}
                  {(repeatCount ?? 0) > 1 && (
                    <span className="mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full border border-border/60 px-1.5 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground">
                      x{repeatCount}
                    </span>
                  )}
                </div>
              )}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
