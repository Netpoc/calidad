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
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/modules/dashboard/DashboardView.vue'),
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
