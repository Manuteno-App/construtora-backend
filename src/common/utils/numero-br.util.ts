/** Parses Brazilian quantities without allowing JavaScript's partial parseFloat behaviour. */
export function parseNumeroBR(value?: string | null): number | undefined {
  if (!value) return undefined;
  const raw = value.trim().replace(/\s/g, '');
  if (!raw) return undefined;
  // Vision sometimes returns the printed quantity with its unit in the same
  // field. Strip only known trailing units so unknown suffixes stay invalid.
  const numeric = raw.replace(
    /(?:m(?:\u00b2|\u00b3|2|3)|t[.]?km|ton(?:eladas?)?|kg|ml|km|un(?:id)?|ud|vb|ha|m\u00eas|mes|hr|h|l|m)$/i,
    '',
  );
  if (/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(numeric)) {
    const parsed = Number(numeric.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (/^-?\d+\.\d{1,2}$/.test(numeric)) {
    const parsed = Number(numeric);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
