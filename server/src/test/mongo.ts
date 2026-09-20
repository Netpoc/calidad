import { MongoMemoryServer } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'

let server: MongoMemoryServer | undefined

/**
 * A real MongoDB, in memory. Unique-index behaviour is under test (same phone
 * at two businesses must be allowed, at one must not), so indexes are built
 * before the first insert instead of lazily.
 */
export async function startMongo(): Promise<void> {
  server = await MongoMemoryServer.create()
  await connectDb(server.getUri())
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()))
}

export async function resetDb(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((model) => model.deleteMany({})))
}

export async function stopMongo(): Promise<void> {
  await disconnectDb()
  await server?.stop()
}
