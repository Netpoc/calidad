import { computed, ref } from 'vue'

/** Chrome/Edge/Samsung's install event — not in the DOM typings yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISSED_KEY = 'calidad.installDismissedAt'
/** A dismissed banner comes back after a week — staff change phones. */
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000

const deferred = ref<BeforeInstallPromptEvent | null>(null)
const installed = ref(false)
const dismissedAt = ref(readDismissed())

function readDismissed(): number {
  try {
    return Number(localStorage.getItem(DISMISSED_KEY)) || 0
  } catch {
    return 0
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own flag for a home-screen launch.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhone/iPad, including iPadOS reporting itself as a Mac. */
function isIos(): boolean {
  const ua = navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}

/**
 * Must run before the app mounts: the browser fires `beforeinstallprompt`
 * once, early, and a listener added later in a component misses it.
 */
export function captureInstallPrompt(): void {
  installed.value = isStandalone()
  window.addEventListener('beforeinstallprompt', (event) => {
    // Hold the browser's own mini-infobar; we offer install at a better moment.
    event.preventDefault()
    deferred.value = event as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    deferred.value = null
  })
}

/**
 * How this device can install the app, if at all:
 * - `prompt`: Chrome, Edge, Samsung Internet on Android/desktop — one tap.
 * - `ios`: Safari has no prompt; the person must use Share → Add to Home Screen.
 * - `null`: already installed, dismissed recently, or not supported here.
 */
export function useInstall() {
  const mode = computed<'prompt' | 'ios' | null>(() => {
    if (installed.value) return null
    if (Date.now() - dismissedAt.value < DISMISS_FOR_MS) return null
    if (deferred.value) return 'prompt'
    if (isIos()) return 'ios'
    return null
  })

  async function install(): Promise<void> {
    const event = deferred.value
    if (!event) return
    // A deferred prompt is single-use, accepted or not.
    deferred.value = null
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') installed.value = true
  }

  function dismiss(): void {
    dismissedAt.value = Date.now()
    try {
      localStorage.setItem(DISMISSED_KEY, String(dismissedAt.value))
    } catch {
      // Private mode: the banner simply returns next visit.
    }
  }

  return { mode, install, dismiss }
}
