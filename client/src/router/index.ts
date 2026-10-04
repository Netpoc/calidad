import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { getAuthToken } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { ROLE_RANK, type Role } from '@/api/types'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    /** Minimum role. The server enforces this too — this only hides the view. */
    minRole?: Role
    /** Platform-admin screens: the only place a platform admin may go. */
    platform?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/modules/auth/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    children: [
      { path: '', redirect: '/book' },
      {
        path: 'book',
        name: 'book',
        component: () => import('@/modules/bookings/BookingView.vue'),
      },
      {
        path: 'bookings',
        name: 'bookings',
        component: () => import('@/modules/bookings/BookingListView.vue'),
      },
      {
        path: 'bookings/:id',
        name: 'booking-detail',
        component: () => import('@/modules/bookings/BookingDetailView.vue'),
      },
      {
        path: 'customers',
        name: 'customers',
        component: () => import('@/modules/customers/CustomerSearchView.vue'),
      },
      {
        path: 'customers/:id',
        name: 'customer-detail',
        component: () => import('@/modules/customers/CustomerDetailView.vue'),
      },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/modules/dashboard/DashboardView.vue'),
        meta: { minRole: 'manager' },
      },
      {
        path: 'payments',
        name: 'payments',
        component: () => import('@/modules/payments/PaymentsView.vue'),
        meta: { minRole: 'manager' },
      },
      {
        path: 'pricing',
        name: 'pricing',
        component: () => import('@/modules/pricing/PricingView.vue'),
        meta: { minRole: 'owner' },
      },
      {
        path: 'manage',
        name: 'manage',
        component: () => import('@/modules/manage/ManageView.vue'),
        meta: { minRole: 'manager' },
      },
      {
        path: 'manage/branches',
        name: 'branches',
        component: () => import('@/modules/manage/BranchesView.vue'),
        meta: { minRole: 'owner' },
      },
      {
        // Managers reach this too — they manage staff in their own branches.
        path: 'manage/staff',
        name: 'staff',
        component: () => import('@/modules/manage/StaffView.vue'),
        meta: { minRole: 'manager' },
      },
      {
        path: 'platform',
        name: 'platform',
        component: () => import('@/modules/platform/PlatformView.vue'),
        meta: { platform: true, minRole: 'platform_admin' },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/book' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

/**
 * A new deploy's service worker takes over at once and deletes the previous
 * version's files. A page still running the old version then fails to load
 * any screen it had not opened yet — and offline there is no network to fall
 * back to. A full load fetches the new version, which is fully precached, so
 * it works offline too. Once per path, so a genuinely broken build cannot loop.
 */
router.onError((error, to) => {
  const isChunkError = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
    String((error as Error)?.message ?? error),
  )
  if (!isChunkError) return
  const key = `calidad.chunkReload:${to.fullPath}`
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch {
    // No session storage: reload anyway; a loop needs a broken deploy too.
  }
  window.location.assign(to.fullPath)
})

router.beforeEach((to) => {
  if (to.meta.public) return true

  const auth = useAuthStore()
  if (!auth.user) auth.restore()

  if (!getAuthToken()) return { name: 'login', query: { redirect: to.fullPath } }

  // A platform admin has no business to book for; a business user has no
  // reason to see the platform screen. Each is sent to their own home.
  const isPlatform = auth.user?.role === 'platform_admin'
  if (isPlatform && !to.meta.platform) return { name: 'platform' }
  if (!isPlatform && to.meta.platform) return { name: 'book' }

  if (to.meta.minRole && auth.user) {
    if (ROLE_RANK[auth.user.role] < ROLE_RANK[to.meta.minRole]) return { name: 'book' }
  }

  return true
})
