/** Normalizes Indian mobile numbers to their last 10 digits so "+91 98765-43210" and "09876543210" match. */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function isValidPhone(raw: string | null | undefined) {
  return /^[6-9]\d{9}$/.test(normalizePhone(raw));
}

export function formatPhone(p: string) {
  return p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p;
}
