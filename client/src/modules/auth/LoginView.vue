<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errorMessage } from '@/api/http'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import AlertBox from '@/components/ui/AlertBox.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const form = reactive({ email: '', password: '' })
const errors = reactive({ email: '', password: '' })
const formError = ref('')

/**
 * A plain <form> with a submit handler. The previous Ant Design form silently
 * swallowed submits unless it was given a `:model`, which is exactly the kind
 * of hidden contract this rewrite removes.
 */
async function submit() {
  errors.email = ''
  errors.password = ''
  formError.value = ''

  if (!/^\S+@\S+\.\S+$/.test(form.email)) errors.email = 'Enter a valid email address'
  if (!form.password) errors.password = 'Enter your password'
  if (errors.email || errors.password) return

  try {
    await auth.login(form.email, form.password)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/book'
    await router.push(auth.isPlatformAdmin ? '/platform' : redirect)
  } catch (e) {
    formError.value = errorMessage(e)
  }
}
</script>

<template>
  <div class="flex min-h-screen flex-col justify-center bg-brand-700 p-4">
    <div class="mx-auto w-full max-w-sm">
      <div class="mb-6 text-center">
        <div
          class="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15"
          aria-hidden="true"
        >
          <svg viewBox="0 0 32 32" class="h-10 w-10" fill="none">
            <circle cx="16" cy="16" r="11" stroke="white" stroke-width="2.5" />
            <circle cx="16" cy="16" r="4" fill="white" />
          </svg>
        </div>
        <h1 class="m-0 text-2xl font-bold text-white">Calidad Laundry</h1>
        <p class="m-0 mt-1 text-sm text-brand-100">Book and manage laundry</p>
      </div>

      <form class="space-y-4 rounded-2xl bg-white p-6" novalidate @submit.prevent="submit">
        <BaseInput
          v-model="form.email"
          label="Email"
          type="email"
          autocomplete="username"
          placeholder="you@calidad.local"
          :error="errors.email"
        />
        <BaseInput
          v-model="form.password"
          label="Password"
          type="password"
          autocomplete="current-password"
          :error="errors.password"
        />

        <AlertBox v-if="formError" tone="error">{{ formError }}</AlertBox>

        <BaseButton type="submit" block :loading="auth.loading">Sign in</BaseButton>
      </form>
    </div>
  </div>
</template>
