<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useInstall } from '@/composables/useInstall'

/**
 * Offers to put the app on the home screen. Installed, it opens full screen
 * from an icon and starts with no connection — the browser's own install
 * control is buried in a menu most counter staff never open.
 */
const { mode, install, dismiss } = useInstall()
</script>

<template>
  <section
    v-if="mode"
    class="flex items-start gap-3 rounded-xl border border-brand-100 bg-white p-3 shadow-sm"
    aria-labelledby="install-title"
  >
    <img src="/pwa-192.png" alt="" class="h-10 w-10 shrink-0 rounded-xl" />
    <div class="min-w-0 flex-1">
      <h2 id="install-title" class="m-0 text-sm font-bold text-slate-900">
        Install Calidad on this device
      </h2>
      <p v-if="mode === 'prompt'" class="m-0 text-xs text-slate-600">
        Opens from your home screen and keeps working with no internet.
      </p>
      <p v-else class="m-0 text-xs text-slate-600">
        Tap
        <AppIcon name="share" label="Share" class="inline align-[-2px] text-sm text-brand-700" />
        <strong>Share</strong>, then <strong>Add to Home Screen</strong>. It then works with no
        internet.
      </p>
      <BaseButton
        v-if="mode === 'prompt'"
        size="sm"
        icon="download"
        class="mt-2"
        @click="install"
      >
        Install app
      </BaseButton>
    </div>
    <button
      type="button"
      class="flex min-h-tap min-w-tap shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-lg text-slate-500"
      aria-label="Not now"
      @click="dismiss"
    >
      <AppIcon name="x" />
    </button>
  </section>
</template>
