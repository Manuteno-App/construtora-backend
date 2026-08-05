/** Parses Brazilian quantities without allowing JavaScript's partial parseFloat behaviour. */
export function parseNumeroBR(value?: string | null, unitSymbol?: string | null): number | undefined {
  if (!value) return undefined;
  const raw = value.trim().replace(/\s/g, '').replace(/;+$/, '').replace(/^\((.+)\)$/, '$1');
  if (!raw) return undefined;
  // Vision sometimes returns the printed quantity with its unit in the same
  // field. Strip only known trailing units so unknown suffixes stay invalid.
  const knownUnitStripped = raw.replace(
    /(?:m(?:\u00b2|\u00b3|2|3)|t[.]?km|ton(?:eladas?)?|kg|ml|km|un(?:id)?|ud|vb|ha|m\u00eas|mes|hr|h|l|m|t)$/i,
    '',
  );
  const unit = unitSymbol?.trim().replace(/\s/g, '');
  const numeric = unit
    ? knownUnitStripped.replace(new RegExp(escapeRegex(unit) + '\\.?$', 'i'), '')
    : knownUnitStripped;
  const repairedNumeric = repairRepeatedCommaQuantity(numeric);
  if (/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/.test(repairedNumeric)) {
    const parsed = Number(repairedNumeric.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (/^-?\d+\.\d{1,6}$/.test(repairedNumeric)) {
    const parsed = Number(repairedNumeric);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

function repairRepeatedCommaQuantity(value: string): string {
  // OCR may turn a Brazilian thousands dot into a comma, e.g. 91,488,00.
  // Only repair full 3-digit groups followed by one final decimal group.
  if (!/^-?\d{1,3}(?:,\d{3})+,\d{1,6}$/.test(value)) return value;
  const decimalIndex = value.lastIndexOf(',');
  return value.slice(0, decimalIndex).replace(/,/g, '') + '.' + value.slice(decimalIndex + 1);
}
