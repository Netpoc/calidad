import type { Request } from 'express'

/**
 * Express 5 types route params as `string | string[]`, since a repeated param
 * yields an array. Our routes all take single values, so this narrows once
 * rather than at every call site.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name]
  if (typeof value !== 'string' || value === '') {
    throw new HttpError(400, `Missing route parameter: ${name}`)
  }
  return value
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}
