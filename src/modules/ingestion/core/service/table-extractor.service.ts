import { Injectable, Logger } from '@nestjs/common';
import type { OcrResult } from './vision.service';

export interface ServicoItem {
  categoria?: string;
  codigo?: string;
  descricao: string;
  unidade?: string;
  /** Exact quantity returned by OCR/native text; parsed only before persistence. */
  quantidadeRaw?: string;
  quantidade?: number;
  baixaConfianca?: boolean;
  /** Context used in the persistence key; intentionally not displayed or persisted. */
  sourceScope?: string;
  metodoExtracao?: 'NATIVE' | 'VISION';
}

// All-uppercase header pattern (e.g. TERRAPLENAGEM, SERVIÇOS PRELIMINARES)
const CATEGORY_HEADER_RE = /^[A-ZÀÁÂÃÉÊÍÓÔÕÚÜ\s\\/(),.-]{5,}$/;

// Patterns that should NOT become category names: totals, subtotals, soma, and pure
// section codes (e.g. "01", "01.01", "E-01") that carry no descriptive text.
const INVALID_CATEGORY_RE =
  /^(sub)?total\b|^soma\b|^\s*[A-Z]{0,3}[-.]?\d+([.\-]\d+)*\s*$/i;

/**
 * Returns true when `text` looks like a genuine category/section header
 * and should update `currentCategory`.
 */
export function isValidCategoryHeader(text: string): boolean {
  return !!text && text.length >= 3 && !INVALID_CATEGORY_RE.test(text);
}

// Legacy regex for raw text fallback — more flexible spacing
const TABLE_ROW_RE =
  /^\s*([A-Z0-9][\w./\-]{0,19})\s{2,}(.{5,80?}?)\s{2,}(m[²³]?|km|un|cj|vb|ton|l\b|m\b|m2|m3|ha|gl|sg|mês|mes|hr|h\b|pç|pc)\s{1,}([\d.,]+)\s*$/i;

@Injectable()
export class TableExtractorService {
  private readonly logger = new Logger(TableExtractorService.name);

  /**
   * Picks the best extraction strategy.
   * Priority: (1) rawServiceRows from Vision structured block, (2) regex over native text.
   */
  extractBest(ocrResult: OcrResult): ServicoItem[] {
    if (ocrResult.rawServiceRows && ocrResult.rawServiceRows.length > 0) {
      return this.extractFromVisionRows(ocrResult.rawServiceRows);
    }
    return this.extractFromText(ocrResult.text);
  }

  /** Convert rawServiceRows (from Vision CSV block) into ServicoItem[]. */
  extractFromVisionRows(rows: NonNullable<OcrResult['rawServiceRows']>): ServicoItem[] {
    return rows.map((r) => ({
      categoria: r.categoria,
      codigo: r.codigo || undefined,
      descricao: r.descricao,
      unidade: r.unidade || undefined,
      quantidadeRaw: r.quantidadeRaw,
      sourceScope: r.sourceScope,
      baixaConfianca: r.baixaConfianca,
      metodoExtracao: 'VISION',
    }));
  }

  /** Parse service items from raw OCR text using regex (legacy / fallback) */
  extractFromText(text: string): ServicoItem[] {
    const lines = text.split('\n');
    const results: ServicoItem[] = [];
    let currentCategory = 'GERAL';

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (CATEGORY_HEADER_RE.test(line) && line.length > 4 && isValidCategoryHeader(line)) {
        currentCategory = line;
        continue;
      }

      const match = TABLE_ROW_RE.exec(line);
      if (match) {
        const [, codigo, descricao, unidade, quantidadeRaw] = match;
        results.push({
          categoria: currentCategory,
          codigo,
          descricao: descricao.trim(),
          unidade,
          quantidadeRaw,
          metodoExtracao: 'NATIVE',
        });
      }
    }

    return results;
  }

  /** @deprecated Use extractBest(ocrResult) — kept for backward compatibility */
  extract(text: string): ServicoItem[] {
    return this.extractFromText(text);
  }
}

