<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { IconName } from '@/components/ui/icons'
import ConnectionBadge from '@/components/ConnectionBadge.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

/**
 * Bottom nav caps at five. Branches, users and the price list live behind
 * "Manage" instead of taking their own tabs — they are occasional admin, not
 * the counter work staff do all day.
 */
const navItems = computed(() => {
  const items: Array<{ key: string; label: string; icon: IconName; match: string }> = [
    { key: 'book', label: 'Book', icon: 'plus-circle', match: '/book' },
    { key: 'bookings', label: 'Bookings', icon: 'list', match: '/bookings' },
  ]
  if (auth.canSeeDashboard) {
    items.push({ key: 'dashboard', label: 'Revenue', icon: 'gauge', match: '/dashboard' })
    items.push({ key: 'manage', label: 'Manage', icon: 'cog', match: '/manage' })
  }
  return items
})

/** Sub-pages keep their parent tab lit — /manage/staff still shows "Manage". */
function isActive(match: string): boolean {
  // The price list is reached through Manage, so it lights that tab too.
  if (match === '/manage') return route.path.startsWith('/manage') || route.path === '/pricing'
  return route.path === match || route.path.startsWith(`${match}/`)
}

function logout() {
  auth.logout()
  void router.push({ name: 'login' })
}
</script>

<template>
  <div class="flex min-h-screen flex-col">
    <header class="sticky top-0 z-30 bg-brand-700 px-4 py-3 text-white">
      <div class="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <div class="min-w-0">
          <h1 class="m-0 truncate text-base font-bold">Calidad Laundry</h1>
          <p class="m-0 truncate text-xs capitalize text-brand-100">
            {{ auth.user?.name }} · {{ auth.user?.role }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <ConnectionBadge />
          <button
            type="button"
            class="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent text-lg text-white hover:bg-white/15"
            aria-label="Sign out"
            @click="logout"
          >
            <AppIcon name="logout" />
          </button>
        </div>
      </div>
    </header>

    <main class="flex-1 pb-24">
      <router-view />
    </main>

    <!-- Thumb-reachable for one-handed use at the counter. The active item is
         marked by colour, weight, and a top bar, so it never relies on colour
         alone. -->
    <nav class="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white">
      <router-link
        v-for="item in navItems"
        :key="item.key"
        :to="item.match"
        class="relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs no-underline"
        :class="isActive(item.match) ? 'font-bold text-brand-700' : 'text-slate-500'"
      >
        <span
          v-if="isActive(item.match)"
          class="absolute inset-x-4 top-0 h-1 rounded-b-full bg-brand-600"
          aria-hidden="true"
        />
        <AppIcon :name="item.icon" class="text-xl" />
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
  </div>
</template>
