import { Schema, model, type InferSchemaType } from 'mongoose'

const smsLogSchema = new Schema(
  {
    to: { type: String, required: true },
    message: { type: String, required: true },
    /** e.g. `booking:<id>:confirmed` — see sendSms in sms.service.ts. */
    dedupeKey: { type: String, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    driver: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    providerId: { type: String, default: '' },
    error: { type: String, default: '' },
    sentAt: { type: Date },
  },
  { timestamps: true },
)

smsLogSchema.index({ dedupeKey: 1 }, { unique: true })

export type SmsLog = InferSchemaType<typeof smsLogSchema>
export const SmsLogModel = model('SmsLog', smsLogSchema)
