<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { IconName } from '@/components/ui/icons'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

/**
 * A hub rather than four more bottom-nav tabs: the nav is capped at five, and
 * these are occasional admin tasks, not the counter work staff do all day.
 */
interface Entry {
  to: string
  icon: IconName
  title: string
  hint: string
  tint: string
}

const entries = computed<Entry[]>(() => {
  const items: Entry[] = [
    {
      to: '/manage/staff',
      icon: 'users',
      title: auth.isOwner ? 'Users' : 'Staff',
      hint: auth.isOwner
        ? 'Create managers and staff, assign branches'
        : 'Add staff to the branches you manage',
      tint: 'bg-blue-50 text-blue-700',
    },
  ]
  if (auth.isOwner) {
    items.unshift({
      to: '/manage/branches',
      icon: 'store',
      title: 'Branches',
      hint: 'Add HQ and branch locations',
      tint: 'bg-violet-50 text-violet-700',
    })
    items.push({
      to: '/pricing',
      icon: 'tag',
      title: 'Price list',
      hint: 'Update what each item costs',
      tint: 'bg-amber-50 text-amber-700',
    })
  }
  return items
})
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-3 p-3">
    <router-link
      v-for="entry in entries"
      :key="entry.to"
      :to="entry.to"
      class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 no-underline transition-colors hover:border-brand-300 hover:bg-brand-50"
    >
      <span
        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl"
        :class="entry.tint"
        aria-hidden="true"
      >
        <AppIcon :name="entry.icon" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-base font-bold text-slate-900">{{ entry.title }}</span>
        <span class="block text-sm text-slate-500">{{ entry.hint }}</span>
      </span>
      <AppIcon name="chevron-right" class="text-lg text-slate-400" />
    </router-link>
  </div>
</template>
