import { Injectable } from '@nestjs/common';

@Injectable()
export class UnitNormalizationService {
  private readonly knownQuantityAttachedSymbols = new Set([
    'mm', 'cm', 'm', 'km',
    'g', 'kg', 't',
    'l', 'ha',
    'm2', 'km2', 'cm2', 'mm2',
    'm3', 'cm3', 'mm3',
  ]);

  normalize(raw?: string | null): string {
    if (!raw) return '';

    const base = raw
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/²/g, '2')
      .replace(/³/g, '3')
      .replace(/cent[ií]metros?/g, 'cm')
      .replace(/mil[ií]metros?/g, 'mm')
      .replace(/quil[oô]metros?/g, 'km')
      .replace(/metros?/g, 'm')
      .replace(/quilogramas?/g, 'kg')
      .replace(/gramas?/g, 'g')
      .replace(/toneladas?/g, 't')
      .replace(/^ton$/, 't')
      .replace(/litros?/g, 'l')
      .replace(/^m2$/, 'm2')
      .replace(/^km2$/, 'km2')
      .replace(/^m3$/, 'm3');

    if (!base || /^[0-9.,]+$/.test(base)) return '';

    const quantityAttachedMatch = base.match(/^[0-9]+(?:[.,][0-9]+)?([a-z]+[23]?)$/);
    if (quantityAttachedMatch) {
      const candidate = quantityAttachedMatch[1];
      return this.knownQuantityAttachedSymbols.has(candidate) ? candidate : '';
    }

    if (/[0-9]/.test(base) && !this.isValidExponentUnit(base)) {
      return '';
    }

    if (!/^[a-z]+[23]?$/.test(base)) {
      return '';
    }

    return base;
  }

  canonicalize(normalized: string): string {
    switch (normalized) {
      case 'm2':
        return 'm²';
      case 'km2':
        return 'km²';
      case 'm3':
        return 'm³';
      case 'l':
        return 'L';
      default:
        return normalized;
    }
  }

  isValidStoredSymbol(normalized?: string | null): boolean {
    return this.normalize(normalized) === (normalized ?? '');
  }

  normalizeServiceKey(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 255);
  }

  private isValidExponentUnit(value: string): boolean {
    return /^(?:mm|cm|m|km)[23]$/.test(value);
  }
}
