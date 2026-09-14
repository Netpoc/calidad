import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { env } from '../config/env.js'
import { HttpError } from '../shared/http-error.js'

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' })
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    })
    return
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message, details: error.details })
    return
  }

  // Duplicate key surfacing as a 500 usually means a missing guard upstream.
  if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
    res.status(409).json({ error: 'That record already exists' })
    return
  }

  console.error('Unhandled error:', error)
  res.status(500).json({
    error: 'Internal server error',
    ...(env.NODE_ENV === 'development' && {
      detail: error instanceof Error ? error.message : String(error),
    }),
  })
}
