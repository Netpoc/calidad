import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { getAuthToken } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import type { Role } from '@/api/types'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    /** Minimum role. The server enforces this too — this only hides the view. */
    minRole?: Role
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
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/book' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

const ROLE_RANK: Record<Role, number> = { owner: 3, manager: 2, staff: 1, customer: 0 }

router.beforeEach((to) => {
  if (to.meta.public) return true

  const auth = useAuthStore()
  if (!auth.user) auth.restore()

  if (!getAuthToken()) return { name: 'login', query: { redirect: to.fullPath } }

  if (to.meta.minRole && auth.user) {
    if (ROLE_RANK[auth.user.role] < ROLE_RANK[to.meta.minRole]) return { name: 'book' }
  }

  return true
})
