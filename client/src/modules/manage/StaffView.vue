<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { http, errorMessage } from '@/api/http'
import AppIcon from '@/components/ui/AppIcon.vue'
import AlertBox from '@/components/ui/AlertBox.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import type { Branch, Role } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'

interface ManagedUser {
  _id: string
  name: string
  email: string
  phone?: string
  role: Role
  active: boolean
  branchIds: Array<{ _id: string; name: string } | string>
}

const auth = useAuthStore()
const toast = useToast()

const users = ref<ManagedUser[]>([])
const branches = ref<Branch[]>([])
const loading = ref(false)
const saving = ref(false)
const showForm = ref(false)

const form = reactive({ name: '', email: '', password: '', phone: '', role: 'staff' as Role })
const selectedBranches = ref<string[]>([])
const errors = reactive<Record<string, string>>({})

/** An owner may create any role; a manager may only create staff. */
const roleOptions = computed(() =>
  auth.isOwner
    ? [
        { value: 'staff', label: 'Staff — books laundry at one branch' },
        { value: 'manager', label: 'Manager — runs one or more branches' },
        { value: 'owner', label: 'Owner — full access to everything' },
      ]
    : [{ value: 'staff', label: 'Staff — books laundry at one branch' }],
)

/** Owner and customer accounts are not branch-scoped. */
const needsBranches = computed(() => form.role === 'staff' || form.role === 'manager')

const ROLE_STYLES: Record<Role, string> = {
  platform_admin: 'bg-slate-900 text-white',
  owner: 'bg-violet-100 text-violet-800',
  manager: 'bg-blue-100 text-blue-800',
  staff: 'bg-green-100 text-green-800',
  customer: 'bg-slate-100 text-slate-700',
}

function branchNames(user: ManagedUser): string {
  const names = user.branchIds
    .map((b) => (typeof b === 'object' ? b.name : ''))
    .filter(Boolean)
  return names.length ? names.join(', ') : 'All branches'
}

async function load() {
  loading.value = true
  try {
    const [usersRes, branchRes] = await Promise.all([
      http.get<{ users: ManagedUser[] }>('/auth/users'),
      http.get<{ branches: Branch[] }>('/branches'),
    ])
    users.value = usersRes.data.users
    branches.value = branchRes.data.branches
  } catch (e) {
    toast.error(errorMessage(e))
  } finally {
    loading.value = false
  }
}

function toggleBranch(id: string) {
  selectedBranches.value = selectedBranches.value.includes(id)
    ? selectedBranches.value.filter((b) => b !== id)
    : [...selectedBranches.value, id]
}

async function create() {
  Object.keys(errors).forEach((k) => delete errors[k])

  if (!form.name.trim()) errors.name = 'Enter a name'
  if (!/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Enter a valid email'
  if (form.password.length < 8) errors.password = 'At least 8 characters'
  if (needsBranches.value && selectedBranches.value.length === 0) {
    errors.branches = 'Choose at least one branch'
  }
  if (Object.keys(errors).length > 0) return

  saving.value = true
  try {
    await http.post('/auth/users', {
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      phone: form.phone.trim(),
      role: form.role,
      branchIds: needsBranches.value ? selectedBranches.value : [],
    })
    toast.success(`${form.name.trim()} can now sign in`)
    form.name = ''
    form.email = ''
    form.password = ''
    form.phone = ''
    selectedBranches.value = []
    showForm.value = false
    await load()
  } catch (e) {
    errors.email = errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function toggleActive(user: ManagedUser) {
  try {
    await http.patch(`/auth/users/${user._id}`, { active: !user.active })
    await load()
    toast.success(`${user.name} ${user.active ? 'deactivated' : 'reactivated'}`)
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
        Add {{ auth.isOwner ? 'user' : 'staff' }}
      </BaseButton>
    </div>

    <AlertBox v-if="!auth.isOwner" tone="info">
      You can add staff to the branches you manage. Only the owner creates managers and branches.
    </AlertBox>

    <section v-if="showForm" class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 class="m-0 text-base font-bold text-slate-900">
        New {{ auth.isOwner ? 'user' : 'staff member' }}
      </h2>

      <BaseInput v-model="form.name" label="Full name" :error="errors.name" />
      <BaseInput
        v-model="form.email"
        label="Email"
        type="email"
        autocomplete="off"
        hint="They sign in with this"
        :error="errors.email"
      />
      <BaseInput
        v-model="form.password"
        label="Temporary password"
        type="password"
        autocomplete="new-password"
        hint="At least 8 characters — ask them to change it"
        :error="errors.password"
      />
      <BaseInput v-model="form.phone" label="Phone" type="tel" placeholder="Optional" />

      <BaseSelect
        v-if="auth.isOwner"
        v-model="form.role"
        label="Role"
        :options="roleOptions"
      />

      <div v-if="needsBranches">
        <p class="mb-1 text-sm font-medium text-slate-700">
          Branches
          <span class="font-normal text-slate-500">
            — a manager can hold several
          </span>
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="branch in branches"
            :key="branch._id"
            type="button"
            class="min-h-[44px] cursor-pointer rounded-xl border-2 px-3 text-sm font-semibold transition-colors"
            :class="
              selectedBranches.includes(branch._id)
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-slate-200 bg-white text-slate-600'
            "
            :aria-pressed="selectedBranches.includes(branch._id)"
            @click="toggleBranch(branch._id)"
          >
            {{ branch.name }}
          </button>
        </div>
        <p v-if="errors.branches" class="m-0 mt-1 text-sm font-medium text-red-600">
          {{ errors.branches }}
        </p>
      </div>

      <div class="flex gap-2 pt-1">
        <BaseButton :loading="saving" @click="create">Create account</BaseButton>
        <BaseButton variant="secondary" @click="showForm = false">Cancel</BaseButton>
      </div>
    </section>

    <EmptyState
      v-if="!loading && users.length === 0"
      icon="users"
      title="No users yet"
      hint="Add staff so they can book laundry at the counter."
    />

    <article
      v-for="user in users"
      :key="user._id"
      class="rounded-xl border border-slate-200 bg-white p-4"
      :class="!user.active && 'opacity-60'"
    >
      <div class="flex items-start gap-3">
        <span
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg text-slate-500"
          aria-hidden="true"
        >
          <AppIcon name="user" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="m-0 truncate text-base font-bold text-slate-900">{{ user.name }}</p>
          <p class="m-0 truncate text-sm text-slate-500">{{ user.email }}</p>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              class="rounded-full px-2 py-0.5 text-xs font-semibold capitalize"
              :class="ROLE_STYLES[user.role]"
            >
              {{ user.role }}
            </span>
            <span class="text-xs text-slate-500">{{ branchNames(user) }}</span>
            <span
              v-if="!user.active"
              class="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700"
            >
              Inactive
            </span>
          </div>
        </div>
      </div>
      <BaseButton
        v-if="user._id !== auth.user?.id"
        size="sm"
        :variant="user.active ? 'secondary' : 'primary'"
        block
        class="mt-3"
        @click="toggleActive(user)"
      >
        {{ user.active ? 'Deactivate' : 'Reactivate' }}
      </BaseButton>
    </article>
  </div>
</template>
