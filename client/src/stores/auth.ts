import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { http, setAuthToken, getAuthToken } from '@/api/http'
import { ROLE_RANK, type AuthUser, type Role } from '@/api/types'
import { clearTenantCaches, switchSession } from '@/offline/session'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)

  const isAuthenticated = computed(() => Boolean(user.value))
  /** Mirrors the server's requireRole; the server remains the real gate. */
  const atLeast = (role: Role) =>
    computed(() => (user.value ? ROLE_RANK[user.value.role] >= ROLE_RANK[role] : false))

  const canSeeDashboard = atLeast('manager')
  const isOwner = computed(() => user.value?.role === 'owner')
  const isPlatformAdmin = computed(() => user.value?.role === 'platform_admin')

  /** Queued bookings on this device that belong to a different business. */
  const foreignQueued = ref(0)

  async function login(email: string, password: string): Promise<void> {
    loading.value = true
    try {
      const { data } = await http.post<{
        token: string
        user: Omit<AuthUser, 'tenantName'>
        tenant: { id: string; name: string } | null
      }>('/auth/login', { email, password })

      // A different business on the same phone must never see the previous
      // one's cached prices — clear before the new session becomes visible.
      foreignQueued.value = await switchSession(data.tenant?.id ?? null)

      setAuthToken(data.token)
      user.value = { ...data.user, tenantId: data.tenant?.id ?? null, tenantName: data.tenant?.name ?? null }
      localStorage.setItem('calidad.user', JSON.stringify(user.value))
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
    // Caches go; the outbox stays — unsynced bookings must survive a logout.
    void clearTenantCaches()
  }

  return {
    user,
    loading,
    isAuthenticated,
    canSeeDashboard,
    isOwner,
    isPlatformAdmin,
    foreignQueued,
    login,
    restore,
    logout,
  }
})
