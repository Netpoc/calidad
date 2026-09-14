import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http, setAuthToken, getAuthToken } from '@/api/http'
import type { AuthUser, Role } from '@/api/types'

const ROLE_RANK: Record<Role, number> = { owner: 3, manager: 2, staff: 1, customer: 0 }

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)

  const isAuthenticated = computed(() => Boolean(user.value))
  /** Mirrors the server's requireRole; the server remains the real gate. */
  const atLeast = (role: Role) =>
    computed(() => (user.value ? ROLE_RANK[user.value.role] >= ROLE_RANK[role] : false))

  const canSeeDashboard = atLeast('manager')
  const isOwner = computed(() => user.value?.role === 'owner')

  async function login(email: string, password: string): Promise<void> {
    loading.value = true
    try {
      const { data } = await http.post<{ token: string; user: AuthUser }>('/auth/login', {
        email,
        password,
      })
      setAuthToken(data.token)
      user.value = data.user
      localStorage.setItem('calidad.user', JSON.stringify(data.user))
    } finally {
      loading.value = false
    }
  }

  /**
   * Restores the session from local storage so the app opens straight into
   * work when offline. The cached user is a convenience only — every request
   * still carries the token the server verifies.
   */
  function restore(): void {
    if (!getAuthToken()) return
    const cached = localStorage.getItem('calidad.user')
    if (cached) {
      try {
        user.value = JSON.parse(cached) as AuthUser
      } catch {
        localStorage.removeItem('calidad.user')
      }
    }
  }

  function logout(): void {
    setAuthToken(null)
    localStorage.removeItem('calidad.user')
    user.value = null
  }

  return { user, loading, isAuthenticated, canSeeDashboard, isOwner, login, restore, logout }
})
