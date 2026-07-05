import { Injectable } from '@nestjs/common';

@Injectable()
export class UnitNormalizationService {
  normalize(raw?: string | null): string {
    if (!raw) return '';

    const base = raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/²/g, '2')
      .replace(/³/g, '3')
      .replace(/metros?/g, 'm')
      .replace(/cent[ií]metros?/g, 'cm')
      .replace(/mil[ií]metros?/g, 'mm')
      .replace(/quil[oô]metros?/g, 'km')
      .replace(/quilogramas?/g, 'kg')
      .replace(/gramas?/g, 'g')
      .replace(/toneladas?/g, 't')
      .replace(/^ton$/, 't')
      .replace(/litros?/g, 'l')
      .replace(/^m2$/, 'm2')
      .replace(/^km2$/, 'km2')
      .replace(/^m3$/, 'm3');

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
}
