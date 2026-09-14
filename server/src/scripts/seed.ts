/**
 * Seeds branches, an owner account, and the price list from
 * laundry_price_list.csv. Safe to re-run: everything is upserted by natural key.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDb, disconnectDb } from '../config/db.js'
import { UserModel, hashPassword } from '../modules/auth/user.model.js'
import { BranchModel } from '../modules/branches/branch.model.js'
import { PriceItemModel } from '../modules/pricing/price-item.model.js'

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

async function seed(): Promise<void> {
  await connectDb()

  const hq = await BranchModel.findOneAndUpdate(
    { name: 'HQ' },
    { name: 'HQ', isHeadquarters: true, active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  const branch1 = await BranchModel.findOneAndUpdate(
    { name: 'Branch 1' },
    { name: 'Branch 1', active: true },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  console.log(`Branches ready: ${hq.name}, ${branch1.name}`)

  const ownerEmail = process.env.SEED_OWNER_EMAIL ?? 'owner@calidad.local'
  const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? 'changeme123'
  const existingOwner = await UserModel.findOne({ email: ownerEmail })
  if (existingOwner) {
    console.log(`Owner already exists: ${ownerEmail}`)
  } else {
    await UserModel.create({
      name: 'Owner',
      email: ownerEmail,
      passwordHash: await hashPassword(ownerPassword),
      role: 'owner',
      branchIds: [],
    })
    console.log(`Owner created: ${ownerEmail} / ${ownerPassword}  (change this password)`)
  }

  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8')).filter((row) => row.name)
  let seeded = 0
  for (const [index, row] of rows.entries()) {
    if (row.washStarchIronMinor == null && row.starchIronMinor == null) {
      console.warn(`Skipping "${row.name}" — no price in either tier`)
      continue
    }
    await PriceItemModel.findOneAndUpdate(
      { name: row.name, branchId: null },
      {
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
  console.log(`Price list seeded: ${seeded} items`)

  await disconnectDb()
}

seed().catch(async (error) => {
  console.error('Seed failed:', error)
  await disconnectDb()
  process.exit(1)
})
