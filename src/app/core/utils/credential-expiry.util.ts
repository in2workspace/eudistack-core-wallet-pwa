import dayjs from 'dayjs';

/** Whether the expiry date is in the past. A missing or unparseable date never expires. */
export function hasExpired(validUntil: string | undefined, now = dayjs()): boolean {
  if (!validUntil) {
    return false;
  }
  const expiry = dayjs(validUntil);
  return expiry.isValid() && expiry.isBefore(now);
}
