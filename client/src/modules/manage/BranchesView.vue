<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { http, errorMessage } from '@/api/http'
import AppIcon from '@/components/ui/AppIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { Branch } from '@/api/types'
import { useToast } from '@/composables/useToast'

const toast = useToast()
const branches = ref<Branch[]>([])
const loading = ref(false)
const saving = ref(false)
const showForm = ref(false)

const form = reactive({ name: '', address: '', phone: '' })
const errors = reactive<Record<string, string>>({})

async function load() {
  loading.value = true
  try {
    const { data } = await http.get<{ branches: Branch[] }>('/branches')
    branches.value = data.branches
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    loading.value = false
  }
}

async function create() {
  errors.name = ''
  if (!form.name.trim()) {
    errors.name = 'Give the branch a name'
    return
  }
  saving.value = true
  try {
    await http.post('/branches', {
      name: form.name.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
    })
    toast.success(`${form.name.trim()} created`)
    form.name = ''
    form.address = ''
    form.phone = ''
    showForm.value = false
    await load()
  } catch (e) {
    errors.name = errorMessage(e)
  } finally {
    saving.value = false
  }
}

/** Deactivating keeps historic bookings attached to a real branch record. */
async function toggleActive(branch: Branch) {
  try {
    await http.patch(`/branches/${branch._id}`, { active: !branch.active })
    await load()
    toast.success(`${branch.name} ${branch.active ? 'deactivated' : 'reactivated'}`)
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-3 p-3">
    <div class="flex items-center gap-2">
      <router-link
        to="/manage"
        class="flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-slate-600 no-underline"
      >
        <AppIcon name="arrow-left" /> Manage
      </router-link>
      <BaseButton v-if="!showForm" size="sm" icon="plus" class="ml-auto" @click="showForm = true">
        New branch
      </BaseButton>
    </div>

    <section v-if="showForm" class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="m-0 text-base font-bold text-slate-900">New branch</h2>
      <BaseInput
        v-model="form.name"
        label="Branch name"
        placeholder="Branch 2"
        :error="errors.name"
      />
      <BaseInput v-model="form.address" label="Address" placeholder="Optional" />
      <BaseInput v-model="form.phone" label="Phone" type="tel" placeholder="Optional" />
      <div class="flex gap-2">
        <BaseButton :loading="saving" @click="create">Create branch</BaseButton>
        <BaseButton variant="secondary" @click="showForm = false">Cancel</BaseButton>
      </div>
    </section>

    <EmptyState
      v-if="!loading && branches.length === 0"
      icon="store"
      title="No branches yet"
      hint="Add HQ first, then each branch location."
    />

    <article
      v-for="branch in branches"
      :key="branch._id"
      class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <span
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
        :class="branch.isHeadquarters ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'"
        aria-hidden="true"
      >
        <AppIcon :name="branch.isHeadquarters ? 'bank' : 'store'" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="m-0 flex items-center gap-2 text-base font-bold text-slate-900">
          {{ branch.name }}
          <span
            v-if="branch.isHeadquarters"
            class="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800"
          >
            HQ
          </span>
          <span
            v-if="!branch.active"
            class="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700"
          >
            Inactive
          </span>
        </p>
        <p v-if="branch.address" class="m-0 truncate text-sm text-slate-500">
          {{ branch.address }}
        </p>
      </div>
      <BaseButton
        size="sm"
        :variant="branch.active ? 'secondary' : 'primary'"
        @click="toggleActive(branch)"
      >
        {{ branch.active ? 'Deactivate' : 'Activate' }}
      </BaseButton>
    </article>
  </div>
</template>
