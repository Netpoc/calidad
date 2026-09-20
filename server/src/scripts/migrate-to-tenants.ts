/**
 * One-off migration: single-tenant database → multi-tenant.
 *
 * Wraps all existing business data (users, branches, customers, bookings,
 * price items, SMS log) in one new tenant, drops the old global unique indexes
 * that would now block a second business, and builds the per-tenant ones.
 *
 * Safe to run against a live database: it refuses to run twice (any existing
 * tenant means it already ran), touches only documents with no tenantId, and
 * creates nothing but the tenant and — if PLATFORM_ADMIN_* are set — the
 * platform admin, since bootstrapIfEmpty will not (the database is not empty).
 *
 *   MONGODB_URI=<uri> MIGRATE_TENANT_NAME="Calidad Laundry" \
 *     npm run migrate:tenants --workspace server
 */
import mongoose from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import { env } from '../config/env.js'
import { UserModel } from '../modules/auth/user.model.js'
import { BookingModel } from '../modules/bookings/booking.model.js'
import { BranchModel } from '../modules/branches/branch.model.js'
import { CustomerModel } from '../modules/customers/customer.model.js'
import { SmsLogModel } from '../modules/notifications/sms-log.model.js'
import { PriceItemModel } from '../modules/pricing/price-item.model.js'
import { TenantModel } from '../modules/tenants/tenant.model.js'
import { TENANT_ROLES } from '../shared/domain.js'
import { ensurePlatformAdmin } from './seed.js'

/** Index names Mongoose gave the pre-tenant unique indexes. */
const LEGACY_INDEXES: Array<[mongoose.Model<unknown>, string[]]> = [
  [BranchModel as unknown as mongoose.Model<unknown>, ['name_1']],
  [CustomerModel as unknown as mongoose.Model<unknown>, ['phone_1']],
  [
    BookingModel as unknown as mongoose.Model<unknown>,
    ['clientRequestId_1', 'branchId_1_createdAt_-1', 'branchId_1_status_1_createdAt_-1'],
  ],
  [PriceItemModel as unknown as mongoose.Model<unknown>, ['branchId_1_name_1']],
]

async function migrate(): Promise<void> {
  await migrateData()
  await ensureAdmin()
}

async function migrateData(): Promise<void> {
  if (await TenantModel.exists({})) {
    console.log('A tenant already exists — data is already multi-tenant; skipping the backfill.')
    return
  }

  const name = process.env.MIGRATE_TENANT_NAME?.trim() || 'Calidad Laundry'
  const tenant = await TenantModel.create({ name })
  const tenantId = tenant._id
  console.log(`Created tenant "${name}" (${tenantId})`)

  const missing = { tenantId: { $exists: false } }
  const results = await Promise.all([
    UserModel.updateMany(
      { role: { $in: [...TENANT_ROLES] }, $or: [missing, { tenantId: null }] },
      { $set: { tenantId } },
    ),
    BranchModel.updateMany(missing, { $set: { tenantId } }),
    CustomerModel.updateMany(missing, { $set: { tenantId } }),
    BookingModel.updateMany(missing, { $set: { tenantId } }),
    PriceItemModel.updateMany(missing, { $set: { tenantId } }),
    SmsLogModel.updateMany(missing, { $set: { tenantId } }),
  ])
  const [users, branches, customers, bookings, priceItems, smsLogs] = results.map(
    (r) => r.modifiedCount,
  )
  console.log(
    `Backfilled tenantId — users ${users}, branches ${branches}, customers ${customers}, ` +
      `bookings ${bookings}, price items ${priceItems}, sms logs ${smsLogs}`,
  )

  // The old global unique indexes would reject a second business's "HQ",
  // "Shirt" or customer phone. Drop them; syncIndexes builds the new ones.
  for (const [model, names] of LEGACY_INDEXES) {
    for (const indexName of names) {
      try {
        await model.collection.dropIndex(indexName)
        console.log(`Dropped legacy index ${model.collection.name}.${indexName}`)
      } catch {
        // Not present on this database — fine.
      }
    }
  }
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()))
  console.log('Per-tenant indexes built')
}

/** Runs every time, so a re-run with the env vars set can add the admin later. */
async function ensureAdmin(): Promise<void> {
  if (env.PLATFORM_ADMIN_EMAIL && env.PLATFORM_ADMIN_PASSWORD) {
    const result = await ensurePlatformAdmin({
      email: env.PLATFORM_ADMIN_EMAIL,
      password: env.PLATFORM_ADMIN_PASSWORD,
    })
    console.log(`Platform admin ${result}: ${env.PLATFORM_ADMIN_EMAIL}`)
  } else {
    console.warn(
      'No platform admin created: set PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD and re-run. ' +
        'Without one, nobody can create new businesses.',
    )
  }
}

connectDb()
  .then(migrate)
  .then(disconnectDb)
  .catch(async (error) => {
    console.error('Migration failed:', error)
    await disconnectDb()
    process.exit(1)
  })
