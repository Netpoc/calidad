import axios from 'axios'

/**
 * Relative `/api` by default. In development Vite proxies it; on Netlify a
 * redirect rule in netlify.toml proxies it to the Render backend. Keeping it
 * same-origin means no CORS preflights and the service worker's `/api/...`
 * cache rules keep matching.
 *
 * Set VITE_API_URL (e.g. https://calidad-tthd.onrender.com/api) to call the
 * backend directly instead — then CORS_ORIGIN on the server must list the
 * frontend's origin.
 */
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15_000,
})

let authToken: string | null = localStorage.getItem('calidad.token')

export function setAuthToken(token: string | null): void {
  authToken = token
  if (token) localStorage.setItem('calidad.token', token)
  else localStorage.removeItem('calidad.token')
}

export function getAuthToken(): string | null {
  return authToken
}

http.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      setAuthToken(null)
      // Full reload rather than a router push: an expired token means every
      // cached view is now untrustworthy.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

/** Pulls a human-readable message out of the server's error envelope. */
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string; details?: Array<{ message: string }> }
    if (data?.details?.length) return data.details.map((d) => d.message).join(', ')
    if (data?.error) return data.error
    if (!error.response) return 'No connection — saved on this device'
  }
  return error instanceof Error ? error.message : 'Something went wrong'
}
