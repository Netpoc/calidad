/**
 * Seeding for a multi-tenant deployment.
 *
 *   - `bootstrapIfEmpty()` runs from server startup: on an empty database it
 *     creates ONLY the platform admin (from PLATFORM_ADMIN_* env vars). No
 *     business is created — the admin does that through the app. This is what
 *     Render's shell-less free tier relies on.
 *   - `npm run seed` is a development convenience: platform admin plus a demo
 *     business "Calidad Laundry" with an owner, HQ + Branch 1, and the 33-item
 *     price list from laundry_price_list.csv. Idempotent.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDb, disconnectDb } from '../config/db.js'
import { env } from '../config/env.js'
import { UserModel, hashPassword } from '../modules/auth/user.model.js'
import { BranchModel } from '../modules/branches/branch.model.js'
import { PriceItemModel } from '../modules/pricing/price-item.model.js'
import { TenantModel } from '../modules/tenants/tenant.model.js'
import { createTenantWithOwner } from '../modules/tenants/tenant.service.js'

const here = dirname(fileURLToPath(import.meta.url))
const CSV_PATH = resolve(here, '../../../laundry_price_list.csv')

interface CsvRow {
  name: string
  washStarchIronMinor: number | null
  starchIronMinor: number | null
}

/**
 * The CSV has no category column, but staff need to find one item among 33 on
 * a phone screen, so the list is grouped. Anything unmatched falls back to
 * "general", which the UI shows as "Other" rather than hiding.
 */
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/native|3pcs/i, 'native'],
  [/shirt|singlet/i, 'tops'],
  [/trouser|jeans|boxer|knicker/i, 'bottoms'],
  [/suit|jacket/i, 'formal'],
  [/gown|dress/i, 'dresses'],
  [/bed spread|blanket|pillow|duvet/i, 'bedding'],
  [/towel/i, 'towels'],
  [/curtain|rug|table mat/i, 'home'],
  [/bulk/i, 'bulk'],
]

function categoryFor(name: string): string {
  return CATEGORY_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? 'general'
}

/** Minimal CSV reader: handles the quoted fields present in the price list. */
function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    return {
      name: (cells[1] ?? '').trim(),
      washStarchIronMinor: toMinor(cells[2]),
      starchIronMinor: toMinor(cells[3]),
    }
  })
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}

/**
 * An empty cell means the tier is not offered, which must stay null rather than
 * becoming 0 — see CLAUDE.md. Prices in the CSV are naira; we store kobo.
 */
function toMinor(cell: string | undefined): number | null {
  const trimmed = (cell ?? '').trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? Math.round(value * 100) : null
}

const DEMO_TENANT_NAME = 'Calidad Laundry'
const DEFAULT_PASSWORD = 'changeme123'

/** Creates the platform admin if that email is not already taken. */
export async function ensurePlatformAdmin(params: {
  email: string
  password: string
}): Promise<'created' | 'exists'> {
  const email = params.email.toLowerCase()
  if (await UserModel.exists({ email })) return 'exists'

  await UserModel.create({
    tenantId: null,
    name: 'Platform admin',
    email,
    passwordHash: await hashPassword(params.password),
    role: 'platform_admin',
    branchIds: [],
  })
  return 'created'
}

/** The demo business for local development, with the CSV price list. */
export async function seedDemoTenant(params: {
  ownerEmail: string
  ownerPassword: string
}): Promise<void> {
  let tenant = await TenantModel.findOne({ name: DEMO_TENANT_NAME })
  if (tenant) {
    console.log(`Demo business exists: ${DEMO_TENANT_NAME}`)
  } else {
    const created = await createTenantWithOwner({
      name: DEMO_TENANT_NAME,
      owner: { name: 'Owner', email: params.ownerEmail, password: params.ownerPassword },
    })
    tenant = created.tenant
    console.log(`Demo business created: ${DEMO_TENANT_NAME} (owner ${params.ownerEmail})`)
  }
  const tenantId = tenant._id

  await BranchModel.findOneAndUpdate(
    { tenantId, name: 'Branch 1' },
    { tenantId, name: 'Branch 1', active: true },
    { upsert: true, setDefaultsOnInsert: true },
  )

  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8')).filter((row) => row.name)
  let seeded = 0
  for (const [index, row] of rows.entries()) {
    if (row.washStarchIronMinor == null && row.starchIronMinor == null) {
      console.warn(`Skipping "${row.name}" — no price in either tier`)
      continue
    }
    await PriceItemModel.findOneAndUpdate(
      { tenantId, name: row.name, branchId: null },
      {
        tenantId,
        name: row.name,
        branchId: null,
        category: categoryFor(row.name),
        washStarchIronMinor: row.washStarchIronMinor,
        starchIronMinor: row.starchIronMinor,
        sortOrder: index,
        active: true,
      },
      { upsert: true, setDefaultsOnInsert: true },
    )
    seeded++
  }
  console.log(`Price list seeded for ${DEMO_TENANT_NAME}: ${seeded} items`)
}

/** Development seed over an already-open connection. Never logs a password. */
export async function runSeed(): Promise<void> {
  const adminEmail = env.PLATFORM_ADMIN_EMAIL ?? 'admin@calidad.local'
  const adminPassword = env.PLATFORM_ADMIN_PASSWORD ?? DEFAULT_PASSWORD
  const result = await ensurePlatformAdmin({ email: adminEmail, password: adminPassword })
  console.log(`Platform admin ${result}: ${adminEmail}`)

  await seedDemoTenant({
    ownerEmail: process.env.SEED_OWNER_EMAIL ?? 'owner@calidad.local',
    ownerPassword: process.env.SEED_OWNER_PASSWORD ?? DEFAULT_PASSWORD,
  })

  if (!env.PLATFORM_ADMIN_PASSWORD || !process.env.SEED_OWNER_PASSWORD) {
    console.warn('Default development passwords are in use — never seed production this way.')
  }
}

/**
 * First-boot bootstrap. Acts only when there are no users at all, so it can
 * never touch a live database, and only when the platform admin credentials
 * are set, so the default password never reaches production by accident.
 */
export async function bootstrapIfEmpty(): Promise<void> {
  if ((await UserModel.estimatedDocumentCount()) > 0) return

  if (!env.PLATFORM_ADMIN_EMAIL || !env.PLATFORM_ADMIN_PASSWORD) {
    console.warn(
      'Database is empty but PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD are not set — ' +
        'skipping bootstrap. Set them and restart, or run `npm run seed` for a dev database.',
    )
    return
  }

  console.log('Empty database — creating the platform admin')
  await ensurePlatformAdmin({ email: env.PLATFORM_ADMIN_EMAIL, password: env.PLATFORM_ADMIN_PASSWORD })
  console.log(`Platform admin created: ${env.PLATFORM_ADMIN_EMAIL}`)
}

// CLI entry: `npm run seed` / `tsx src/scripts/seed.ts`.
const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (invokedDirectly) {
  connectDb()
    .then(runSeed)
    .then(disconnectDb)
    .catch(async (error) => {
      console.error('Seed failed:', error)
      await disconnectDb()
      process.exit(1)
    })
}
