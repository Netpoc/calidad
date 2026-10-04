/**
 * One-off migration: running `paidMinor` totals → the payments ledger.
 *
 * Bookings from before the ledger carry money with no record of who took it or
 * how. This gives each one a single `unrecorded` ledger entry dated at the
 * booking and attributed to whoever created it, so cash-basis revenue still
 * counts it and the books balance.
 *
 * Idempotent: it only touches bookings with money and no ledger entries. It
 * changes nothing else, but lists bookings that were handed over while still
 * owing — allowed under the old rules — so the owner can settle them.
 *
 *   MONGODB_URI=<uri> npm run migrate:payments --workspace server
 */
import { Types } from 'mongoose'
import { connectDb, disconnectDb } from '../config/db.js'
import { BookingModel } from '../modules/bookings/booking.model.js'
import { paymentStageFor } from '../shared/domain.js'

async function migrate(): Promise<void> {
  const noLedger = { $or: [{ payments: { $exists: false } }, { payments: { $size: 0 } }] }
  const legacy = await BookingModel.find({ paidMinor: { $gt: 0 }, ...noLedger })
    .select('_id tenantId totalMinor paidMinor createdAt createdByUserId')
    .lean()

  let backfilled = 0
  for (const booking of legacy) {
    const result = await BookingModel.updateOne(
      // Re-checked in the filter so a concurrent payment is never doubled.
      { _id: booking._id, paidMinor: booking.paidMinor, ...noLedger },
      {
        $set: {
          payments: [
            {
              _id: new Types.ObjectId(),
              kind: 'payment',
              amountMinor: booking.paidMinor,
              method: 'unrecorded',
              stage: paymentStageFor(booking.totalMinor, booking.paidMinor),
              at: booking.createdAt,
              byUserId: booking.createdByUserId,
              note: 'Recorded before the payments ledger',
            },
          ],
        },
      },
    )
    backfilled += result.modifiedCount
  }
  console.log(`Backfilled ${backfilled} of ${legacy.length} bookings with an unrecorded payment entry.`)

  const releasedOwing = await BookingModel.find({
    status: 'collected',
    $expr: { $lt: ['$paidMinor', '$totalMinor'] },
  })
    .select('tenantId referenceCode totalMinor paidMinor collectedAt')
    .lean()
  if (releasedOwing.length === 0) {
    console.log('No collected bookings are still owing.')
    return
  }
  console.log(`${releasedOwing.length} bookings were handed over while still owing (left unchanged):`)
  for (const b of releasedOwing) {
    const owed = ((b.totalMinor - b.paidMinor) / 100).toFixed(2)
    console.log(`  tenant ${b.tenantId}  ${b.referenceCode}  owes NGN ${owed}  collected ${b.collectedAt?.toISOString() ?? '?'}`)
  }
}

connectDb()
  .then(migrate)
  .then(disconnectDb)
  .catch(async (error) => {
    console.error(error)
    await disconnectDb()
    process.exit(1)
  })
