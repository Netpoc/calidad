import { createApp } from './app.js'
import { connectDb } from './config/db.js'
import { env } from './config/env.js'
import { bootstrapIfEmpty } from './scripts/seed.js'

async function main(): Promise<void> {
  await connectDb()
  console.log('Connected to MongoDB')

  // No-op on any database that already has users. See seed.ts.
  await bootstrapIfEmpty()

  createApp().listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`)
  })
}

main().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
