import type { Server } from 'node:http'
import { createApp } from '../app.js'

export interface Response<T = Record<string, unknown>> {
  status: number
  body: T
}

export interface Api {
  get<T = Record<string, unknown>>(path: string, token?: string): Promise<Response<T>>
  post<T = Record<string, unknown>>(path: string, body: unknown, token?: string): Promise<Response<T>>
  patch<T = Record<string, unknown>>(path: string, body: unknown, token?: string): Promise<Response<T>>
}

/**
 * Boots the real Express app on a random port and talks to it over HTTP with
 * the global fetch — the same path a browser takes, with no extra dependency.
 */
export async function startServer(): Promise<{ api: Api; close(): Promise<void> }> {
  const server: Server = await new Promise((resolveListen) => {
    const s = createApp().listen(0, () => resolveListen(s))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const base = `http://127.0.0.1:${address.port}/api`

  async function call<T>(method: string, path: string, body?: unknown, token?: string) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as T }
  }

  return {
    api: {
      get: (path, token) => call('GET', path, undefined, token),
      post: (path, body, token) => call('POST', path, body, token),
      patch: (path, body, token) => call('PATCH', path, body, token),
    },
    close: () => new Promise((r) => server.close(() => r())),
  }
}
