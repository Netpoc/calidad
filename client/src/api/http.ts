import axios from 'axios'

export const http = axios.create({
  baseURL: '/api',
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
