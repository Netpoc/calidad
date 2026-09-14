import { ref } from 'vue'
import type { IconName } from '@/components/ui/icons'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

const TONE_ICONS: Record<ToastTone, IconName> = {
  success: 'check-circle',
  error: 'x-circle',
  info: 'inbox',
  warning: 'warning',
}

const toasts = ref<Toast[]>([])
let nextId = 1

/**
 * Replaces Ant Design's `message`. Toasts announce through a single polite
 * live region (see ToastHost) rather than each becoming its own, so a screen
 * reader reads them in order instead of interrupting itself.
 */
export function useToast() {
  function push(tone: ToastTone, message: string, ms = 4000) {
    const id = nextId++
    toasts.value.push({ id, tone, message })
    window.setTimeout(() => dismiss(id), ms)
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  return {
    toasts,
    dismiss,
    iconFor: (tone: ToastTone) => TONE_ICONS[tone],
    success: (m: string) => push('success', m),
    error: (m: string) => push('error', m, 6000),
    info: (m: string) => push('info', m),
    warning: (m: string) => push('warning', m, 5000),
  }
}
