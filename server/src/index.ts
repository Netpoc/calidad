import { createApp } from './app.js'
import { connectDb } from './config/db.js'
import { env } from './config/env.js'

async function main(): Promise<void> {
  await connectDb()
  console.log('Connected to MongoDB')

  createApp().listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`)
  })
}

main().catch((error) => {
  console.error('Failed to start server:', error)
  process.exit(1)
})
