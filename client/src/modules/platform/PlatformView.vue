<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { http, errorMessage } from '@/api/http'
import AppIcon from '@/components/ui/AppIcon.vue'
import AlertBox from '@/components/ui/AlertBox.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { TenantSummary } from '@/api/types'
import { plural } from '@/composables/useMoney'
import { useToast } from '@/composables/useToast'

const toast = useToast()
const tenants = ref<TenantSummary[]>([])
const loading = ref(false)
const saving = ref(false)
const showForm = ref(false)
/** Shown once after creation so the admin can hand the owner their login. */
const justCreated = ref<{ business: string; email: string } | null>(null)

const form = reactive({ name: '', ownerName: '', ownerEmail: '', ownerPassword: '' })
const errors = reactive<Record<string, string>>({})

async function load() {
  loading.value = true
  try {
    const { data } = await http.get<{ tenants: TenantSummary[] }>('/platform/tenants')
    tenants.value = data.tenants
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    loading.value = false
  }
}

async function create() {
  Object.keys(errors).forEach((k) => delete errors[k])
  if (form.name.trim().length < 2) errors.name = 'Enter the business name'
  if (!form.ownerName.trim()) errors.ownerName = "Enter the owner's name"
  if (!/^\S+@\S+\.\S+$/.test(form.ownerEmail)) errors.ownerEmail = 'Enter a valid email'
  if (form.ownerPassword.length < 8) errors.ownerPassword = 'At least 8 characters'
  if (Object.keys(errors).length > 0) return

  saving.value = true
  try {
    await http.post('/platform/tenants', {
      name: form.name.trim(),
      owner: {
        name: form.ownerName.trim(),
        email: form.ownerEmail.trim(),
        password: form.ownerPassword,
      },
    })
    justCreated.value = { business: form.name.trim(), email: form.ownerEmail.trim() }
    form.name = ''
    form.ownerName = ''
    form.ownerEmail = ''
    form.ownerPassword = ''
    showForm.value = false
    await load()
  } catch (e) {
    // A taken email is the one failure the admin can fix from the form.
    errors.ownerEmail = errorMessage(e)
  } finally {
    saving.value = false
  }
}

/**
 * Deactivating locks every account in the business out within a minute —
 * including tokens already issued — and keeps all their data for reactivation.
 */
async function toggleActive(tenant: TenantSummary) {
  try {
    await http.patch(`/platform/tenants/${tenant.id}`, { active: !tenant.active })
    await load()
    toast.success(`${tenant.name} ${tenant.active ? 'deactivated' : 'reactivated'}`)
  } catch (e) {
    toast.error(errorMessage(e))
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-3 p-3">
    <div class="flex items-center justify-between gap-2">
      <h2 class="m-0 text-lg font-bold text-slate-900">Businesses</h2>
      <BaseButton v-if="!showForm" size="sm" icon="plus" @click="showForm = true">
        New business
      </BaseButton>
    </div>

    <AlertBox v-if="justCreated" tone="success" title="Business created">
      Give <strong>{{ justCreated.email }}</strong> the temporary password you set — they sign in
      and run {{ justCreated.business }} from there. It starts with an HQ branch and an empty
      price list.
    </AlertBox>

    <section v-if="showForm" class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h3 class="m-0 text-base font-bold text-slate-900">New business</h3>
      <BaseInput
        v-model="form.name"
        label="Business name"
        placeholder="Sparkle Wash"
        :error="errors.name"
      />

      <p class="m-0 pt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        First owner
      </p>
      <BaseInput v-model="form.ownerName" label="Owner's name" :error="errors.ownerName" />
      <BaseInput
        v-model="form.ownerEmail"
        label="Owner's email"
        type="email"
        autocomplete="off"
        hint="They sign in with this"
        :error="errors.ownerEmail"
      />
      <BaseInput
        v-model="form.ownerPassword"
        label="Temporary password"
        type="password"
        autocomplete="new-password"
        hint="At least 8 characters — ask them to change it"
        :error="errors.ownerPassword"
      />

      <div class="flex gap-2 pt-1">
        <BaseButton :loading="saving" @click="create">Create business</BaseButton>
        <BaseButton variant="secondary" @click="showForm = false">Cancel</BaseButton>
      </div>
    </section>

    <EmptyState
      v-if="!loading && tenants.length === 0"
      icon="building"
      title="No businesses yet"
      hint="Create the first laundry business and its owner account."
    />

    <article
      v-for="tenant in tenants"
      :key="tenant.id"
      class="rounded-xl border border-slate-200 bg-white p-4"
      :class="!tenant.active && 'opacity-60'"
    >
      <div class="flex items-start gap-3">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl"
          :class="tenant.active ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'"
          aria-hidden="true"
        >
          <AppIcon name="building" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="m-0 flex flex-wrap items-center gap-2 text-base font-bold text-slate-900">
            {{ tenant.name }}
            <!-- Colour and a word, never colour alone. -->
            <span
              class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="tenant.active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'"
            >
              <AppIcon :name="tenant.active ? 'check-circle' : 'x-circle'" />
              {{ tenant.active ? 'Active' : 'Inactive' }}
            </span>
          </p>
          <p class="m-0 mt-0.5 text-sm text-slate-500">
            {{ plural(tenant.counts.users, 'user') }} ·
            {{ plural(tenant.counts.branches, 'branch', 'branches') }} ·
            {{ plural(tenant.counts.bookings, 'booking') }}
          </p>
        </div>
      </div>
      <BaseButton
        size="sm"
        :variant="tenant.active ? 'secondary' : 'primary'"
        block
        class="mt-3"
        @click="toggleActive(tenant)"
      >
        {{ tenant.active ? 'Deactivate' : 'Reactivate' }}
      </BaseButton>
    </article>
  </div>
</template>
