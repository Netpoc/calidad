import cors from 'cors'
import express from 'express'
import morgan from 'morgan'
import { env } from './config/env.js'
import { errorHandler, notFound } from './middleware/error-handler.js'
import authRoutes from './modules/auth/auth.routes.js'
import bookingRoutes from './modules/bookings/booking.routes.js'
import branchRoutes from './modules/branches/branch.routes.js'
import customerRoutes from './modules/customers/customer.routes.js'
import dashboardRoutes from './modules/dashboard/dashboard.routes.js'
import pricingRoutes from './modules/pricing/pricing.routes.js'

export function createApp() {
  const app = express()

  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) }))
  app.use(express.json({ limit: '1mb' }))
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'))

  /** Clients poll this to decide whether they are online. */
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() })
  })

  app.use('/api/auth', authRoutes)
  app.use('/api/branches', branchRoutes)
  app.use('/api/customers', customerRoutes)
  app.use('/api/pricing', pricingRoutes)
  app.use('/api/bookings', bookingRoutes)
  app.use('/api/dashboard', dashboardRoutes)

  app.use(notFound)
  app.use(errorHandler)

  return app
}
