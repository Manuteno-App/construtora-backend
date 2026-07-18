/** Parses Brazilian quantities without allowing JavaScript's partial parseFloat behaviour. */
export function parseNumeroBR(value?: string | null): number | undefined {
  if (!value) return undefined;
  const raw = value.trim().replace(/\s/g, '');
  if (!raw) return undefined;
  if (/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(raw)) {
    const parsed = Number(raw.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (/^-?\d+\.\d{1,2}$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
