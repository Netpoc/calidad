/** Money crosses the wire in kobo; humans read naira. */
export function formatNaira(minor: number): string {
  return `₦${(minor / 100).toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

export function toMinor(naira: number): number {
  return Math.round(naira * 100)
}

/** "1 booking", "2 bookings" — grammar the counter staff will notice. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? singular + 's')}`
}
