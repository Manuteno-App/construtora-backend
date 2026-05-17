import { Injectable } from '@nestjs/common';
import type { OcrResult, TextractTable } from './vision.service';

export interface ServicoItem {
  trecho?: string;
  categoria: string;
  codigo?: string;
  descricao: string;
  unidade?: string;
  quantidade?: number;
}

// All-uppercase header pattern (e.g. TERRAPLENAGEM, SERVIÇOS PRELIMINARES)
const CATEGORY_HEADER_RE = /^[A-ZÀÁÂÃÉÊÍÓÔÕÚÜ\s\\/(),.-]{5,}$/;

// Legacy regex for raw text fallback — more flexible spacing
const TABLE_ROW_RE =
  /^\s*([A-Z0-9][\w./\-]{0,19})\s{2,}(.{5,80?}?)\s{2,}(m[²³]?|km|un|cj|vb|ton|l\b|m\b|m2|m3|ha|gl|sg|mês|mes|hr|h\b|pç|pc)\s{1,}([\d.,]+)\s*$/i;

@Injectable()
export class TableExtractorService {
  /**
   * Picks the best extraction strategy.
   * Priority: (1) rawServiceRows from Vision structured block, (2) Textract TABLE blocks, (3) regex over raw text.
   */
  extractBest(ocrResult: OcrResult): ServicoItem[] {
    if (ocrResult.rawServiceRows && ocrResult.rawServiceRows.length > 0) {
      return this.extractFromVisionRows(ocrResult.rawServiceRows);
    }
    if (ocrResult.tables.length > 0) {
      const items = this.extractFromTables(ocrResult.tables);
      if (items.length > 0) return items;
    }
    return this.extractFromText(ocrResult.text);
  }

  /** Convert rawServiceRows (from Vision CSV block) into ServicoItem[]. */
  extractFromVisionRows(rows: NonNullable<OcrResult['rawServiceRows']>): ServicoItem[] {
    return rows.map((r) => {
      const raw = r.quantidade ?? '';
      const quantidade = raw ? parseFloat(raw.replace(/\./g, '').replace(',', '.')) : NaN;
      return {
        categoria: r.categoria ?? 'GERAL',
        codigo:    r.codigo   || undefined,
        descricao: r.descricao,
        unidade:   r.unidade  || undefined,
        quantidade: isNaN(quantidade) ? undefined : quantidade,
      };
    });
  }

  /** Parse structured TABLE blocks returned by Textract AnalyzeDocument */
  extractFromTables(tables: TextractTable[]): ServicoItem[] {
    const results: ServicoItem[] = [];

    for (const table of tables) {
      // Build an (rowIndex, colIndex) → text grid
      const grid = new Map<string, string>();
      for (const cell of table.cells) {
        grid.set(`${cell.rowIndex},${cell.colIndex}`, cell.text);
      }

      const allRows = [...new Set(table.cells.map((c) => c.rowIndex))].sort(
        (a, b) => a - b,
      );
      if (allRows.length < 2) continue;

      // Detect column roles from the header row
      const headerRow = allRows[0];
      let descCol = -1;
      let unidadeCol = -1;
      let quantidadeCol = -1;
      let codigoCol = -1;

      for (const cell of table.cells.filter((c) => c.rowIndex === headerRow)) {
        const t = cell.text.toUpperCase().trim();
        if (/NATUREZA|DESCRI[CÇ]|SERVI[CÇ]O/.test(t)) descCol = cell.colIndex;
        else if (/^UNID|^UN\.?$/.test(t)) unidadeCol = cell.colIndex;
        else if (/QUANT|QTD|QDE/.test(t)) quantidadeCol = cell.colIndex;
        else if (/^C[OÓ]D|^ITEM$|^N[º°.]\s*$|^#/.test(t)) codigoCol = cell.colIndex;
      }

      // Heuristic fallback when header row is missing or not recognised:
      // treat the widest non-numeric cell in the first data row as description
      if (descCol === -1 && allRows.length > 1) {
        const firstDataRow = allRows[1];
        let maxLen = 0;
        for (const cell of table.cells.filter((c) => c.rowIndex === firstDataRow)) {
          if (cell.text.length > maxLen && !/^[\d,.]+$/.test(cell.text.trim())) {
            maxLen = cell.text.length;
            descCol = cell.colIndex;
          }
        }
      }

      if (descCol === -1) continue;

      let currentCategory = 'GERAL';

      for (const rowIdx of allRows.slice(1)) {
        const descText = (grid.get(`${rowIdx},${descCol}`) ?? '').trim();
        if (!descText) continue;

        const qRaw =
          quantidadeCol >= 0 ? (grid.get(`${rowIdx},${quantidadeCol}`) ?? '') : '';
        const hasQuantity = qRaw.trim() !== '' && qRaw.trim() !== '-';

        // Category/subcategory: has a description but no valid quantity.
        // Handles both all-caps headers AND hierarchical code rows (01, 01.01)
        if (!hasQuantity) {
          if (descText) currentCategory = descText;
          continue;
        }

        const unidade =
          unidadeCol >= 0 ? (grid.get(`${rowIdx},${unidadeCol}`) ?? undefined) : undefined;
        const codigo =
          codigoCol >= 0 ? (grid.get(`${rowIdx},${codigoCol}`) ?? undefined) : undefined;
        const quantidade = qRaw
          ? parseFloat(qRaw.replace(/\./g, '').replace(',', '.'))
          : NaN;

        results.push({
          categoria: currentCategory,
          codigo: codigo || undefined,
          descricao: descText,
          unidade: unidade || undefined,
          quantidade: isNaN(quantidade) ? undefined : quantidade,
        });
      }
    }

    return results;
  }

  /** Parse service items from raw OCR text using regex (legacy / fallback) */
  extractFromText(text: string): ServicoItem[] {
    const lines = text.split('\n');
    const results: ServicoItem[] = [];
    let currentCategory = 'GERAL';
    let currentTrecho: string | undefined;

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (CATEGORY_HEADER_RE.test(line) && line.length > 4) {
        currentCategory = line;
        currentTrecho = undefined;
        continue;
      }

      if (/trecho:/i.test(line) || /^\s*[A-Z]{2}-\d{3}/.test(line)) {
        currentTrecho = line;
        continue;
      }

      const match = TABLE_ROW_RE.exec(line);
      if (match) {
        const [, codigo, descricao, unidade, quantidadeRaw] = match;
        const quantidade = parseFloat(quantidadeRaw.replace(',', '.'));
        results.push({
          trecho: currentTrecho,
          categoria: currentCategory,
          codigo,
          descricao: descricao.trim(),
          unidade,
          quantidade: isNaN(quantidade) ? undefined : quantidade,
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

