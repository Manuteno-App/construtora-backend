import {
  Block,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { isValidCategoryHeader } from './table-extractor.service';

// Dynamic imports used to avoid hard dependency at module load time
type CanvasLib = typeof import('canvas');
type PdfjsLib = typeof import('pdfjs-dist');
type TesseractModule = typeof import('tesseract.js');

export interface TextractCell {
  rowIndex: number;
  colIndex: number;
  rowSpan: number;
  colSpan: number;
  text: string;
  confidence: number;
}

export interface TextractTable {
  page: number;
  cells: TextractCell[];
  rows: number;
  cols: number;
}

export interface OcrResult {
  text: string;
  pages: Array<{ pageNumber: number; text: string }>;
  tables: TextractTable[];
  keyValuePairs: Record<string, string>;
  avgConfidence: number;
  /** Service rows extracted directly from the Vision structured table block */
  rawServiceRows?: Array<{
    codigo?: string;
    descricao: string;
    unidade?: string;
    quantidadeRaw?: string;
    categoria?: string;
    baixaConfianca?: boolean;
  }>;
  /** Per-page Vision payload retained only for local development diagnostics. */
  visionDebug?: Array<{
    pageNumber: number;
    response: string;
    rawServiceRows: NonNullable<OcrResult['rawServiceRows']>;
  }>;
}

/**
 * VisionService — GPT-4o Vision OCR for scanned PDFs.
 *
 * Requires pdfjs-dist and canvas to be installed:
 *   npm install pdfjs-dist canvas
 *
 * The service gracefully degrades: if those packages are unavailable, it logs
 * a warning and returns an empty result.
 */
@Injectable()
export class VisionService implements OnModuleInit {
  private readonly logger = new Logger(VisionService.name);
  private readonly openai: OpenAI;

  private canvasLib: CanvasLib | null = null;
  private pdfjsLib: PdfjsLib | null = null;
  private tesseractLib: TesseractModule | null = null;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.get<string>('openaiApiKey') });
  }

  async onModuleInit(): Promise<void> {
    try {
      // canvas is CJS — require works fine
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.canvasLib = require('canvas') as CanvasLib;

      // pdfjs-dist v5 is ESM-only; load via Function-wrapped dynamic import so
      // TypeScript/ts-node doesn't transpile it into a synchronous require().
      this.pdfjsLib = (await new Function(
        'return import("pdfjs-dist")',
      )()) as PdfjsLib;

      this.logger.log('VisionService ready — PDF-to-image rendering enabled');
    } catch (err) {
      this.logger.warn(
        'VisionService disabled: pdfjs-dist or canvas could not be loaded. ' +
          'Run `npm install pdfjs-dist canvas` to enable Vision fallback.',
        err,
      );
    }

    // tesseract.js is optional — enables cheaper Tesseract+GPT-mini OCR path
    try {
      this.tesseractLib = (await new Function(
        'return import("tesseract.js")',
      )()) as TesseractModule;
      this.logger.log('VisionService: tesseract.js loaded — Tesseract OCR enabled');
    } catch {
      this.logger.warn(
        'tesseract.js not available — GPT-4o Vision will be used for OCR. ' +
          'Run `npm install tesseract.js` to enable cheaper Tesseract-based OCR.',
      );
    }
  }

  isAvailable(): boolean {
    return this.canvasLib !== null && this.pdfjsLib !== null;
  }

  /**
   * Analyses a PDF with GPT-4o Vision and returns an OcrResult.
   * Used as the primary OCR path for scanned documents when pdf-parse yields
   * sparse text.
   */
  async analyze(buffer: Buffer, captureDebug = false): Promise<OcrResult> {
    const empty: OcrResult = {
      text: '',
      pages: [],
      tables: [],
      keyValuePairs: {},
      avgConfidence: 0,
    };

    if (!this.isAvailable()) {
      this.logger.warn('VisionService not available — pdfjs-dist or canvas missing');
      return empty;
    }

    try {
      // Stream: render one page → send to GPT → discard image → next page.
      // Avoids holding all pages in memory simultaneously (100-page PDF = 400 MB+).
      const pageTexts: string[] = [];
      const pageRows: NonNullable<OcrResult['rawServiceRows']> = [];
      const visionDebug: NonNullable<OcrResult['visionDebug']> | undefined = captureDebug ? [] : undefined;
      let inheritedCategory: string | undefined;
      const entries = await this.renderPagesFiltered(buffer);
      if (entries.length === 0) return empty;

      for (const { pageNumber, base64 } of entries) {
        const text = await this.callSinglePageVision(base64, pageNumber);
        pageTexts.push(text);
        const rows = this.parseTableBlock(text, inheritedCategory) ?? [];
        inheritedCategory = [...rows].reverse().find((row) => Boolean(row.categoria))?.categoria ?? inheritedCategory;
        pageRows.push(...rows);
        visionDebug?.push({ pageNumber, response: text, rawServiceRows: rows });
        this.logger.log('Vision page ' + pageNumber + '/' + entries.length + ': ' + rows.length + ' service rows');
      }

      let visionText: string;
      try {
        visionText = this.mergePageVisionResults(pageTexts);
      } catch (err) {
        this.logger.warn('mergePageVisionResults failed — returning empty', err);
        return empty;
      }

      // Extract structured blocks before splitting into pages
      const keyValuePairs = this.parseHeaderBlock(visionText);
      const rawServiceRows = pageRows.length ? pageRows : this.parseTableBlock(visionText);
      const cleanText = this.removeStructuredBlocks(visionText);
      const pages = this.splitIntoPages(cleanText);

      return {
        text: pages.map((p) => p.text).join('\n\n'),
        pages,
        tables: [],
        keyValuePairs,
        avgConfidence: 100,
        rawServiceRows,
        visionDebug,
      };
    } catch (err) {
      this.logger.error('Vision analysis failed', err);
      return empty;
    }
  }

  /**
   * Analyses only the specified pages of a PDF with GPT-4o Vision and returns an OcrResult.
   * Used for hybrid OCR on mixed documents: digital pages keep their pdf-parse text while
   * scanned pages (identified by low character count) are sent through Vision.
   */
  async analyzeSelectivePages(buffer: Buffer, pageNumbers: number[], captureDebug = false): Promise<OcrResult> {
    const empty: OcrResult = {
      text: '',
      pages: [],
      tables: [],
      keyValuePairs: {},
      avgConfidence: 0,
    };

    if (!this.isAvailable() || pageNumbers.length === 0) return empty;

    try {
      const pageEntries = await this.renderPagesFiltered(buffer, new Set(pageNumbers));
      if (pageEntries.length === 0) return empty;

      const pageTexts: string[] = [];
      const pageRows: NonNullable<OcrResult['rawServiceRows']> = [];
      const visionDebug: NonNullable<OcrResult['visionDebug']> | undefined = captureDebug ? [] : undefined;
      let inheritedCategory: string | undefined;
      for (const { pageNumber, base64 } of pageEntries) {
        const text = await this.callSinglePageVision(base64, pageNumber);
        pageTexts.push(text);
        const rows = this.parseTableBlock(text, inheritedCategory) ?? [];
        inheritedCategory = [...rows].reverse().find((row) => Boolean(row.categoria))?.categoria ?? inheritedCategory;
        pageRows.push(...rows);
        visionDebug?.push({ pageNumber, response: text, rawServiceRows: rows });
        this.logger.log('Selective Vision page ' + pageNumber + ': ' + rows.length + ' service rows');
      }

      const visionText = this.mergePageVisionResults(pageTexts);
      const keyValuePairs = this.parseHeaderBlock(visionText);
      const rawServiceRows = pageRows.length ? pageRows : this.parseTableBlock(visionText);
      const cleanText = this.removeStructuredBlocks(visionText);
      const pages = this.splitIntoPages(cleanText);

      return {
        text: pages.map((p) => p.text).join('\n\n'),
        pages,
        tables: [],
        keyValuePairs,
        avgConfidence: 100,
        rawServiceRows,
        visionDebug,
      };
    } catch (err) {
      this.logger.error('Selective Vision analysis failed', err);
      return empty;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Renders PDF pages to base64 PNG images.
   * When `pageFilter` is provided, only the specified page numbers are rendered.
   * Returns an array of { pageNumber, base64 } entries in document order.
   *
   * Safety guarantees:
   *  - `stopAtErrors: false` — pdfjs-dist does not abort on corrupt embedded images.
   *  - 30 s per-page timeout with `renderTask.cancel()` — breaks CPU spin loops caused
   *    by corrupt JPEG data (e.g. marker 0xffff).
   *  - Per-page try/catch — one bad page is skipped; the rest of the document continues.
   *  - Scale 1.5 instead of 2.0 — 44 % smaller canvas; less CPU and memory per page.
   *  - Canvas is zeroed after encoding — releases ~8 MB per page immediately.
   */
  private async renderPagesFiltered(
    buffer: Buffer,
    pageFilter?: Set<number>,
  ): Promise<Array<{ pageNumber: number; base64: string }>> {
    const { createCanvas } = this.canvasLib!;
    const pdfjsLib = this.pdfjsLib!;

    // pdfjs-dist v5 requires a real file:// URL — empty string causes "fake worker" failure
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pathToFileURL } = require('url') as typeof import('url');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const workerPath = require.resolve('pdfjs-dist/build/pdf.worker.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).toString();
    }

    // pdfjs-dist v5 requires CanvasFactory to be a class (constructor), not a plain object
    class NodeCanvasFactory {
      create(width: number, height: number) {
        const canvas = createCanvas(width, height);
        return { canvas, context: canvas.getContext('2d') };
      }
      reset(
        obj: { canvas: ReturnType<CanvasLib['createCanvas']> },
        width: number,
        height: number,
      ) {
        obj.canvas.width = width;
        obj.canvas.height = height;
      }
      destroy(obj: { canvas: ReturnType<CanvasLib['createCanvas']> }) {
        obj.canvas.width = 0;
        obj.canvas.height = 0;
      }
    }
    const nodeCanvasFactory = new NodeCanvasFactory();

    const pdfDoc = await pdfjsLib
      .getDocument({
        data: new Uint8Array(buffer),
        CanvasFactory: NodeCanvasFactory as unknown as object,
        useSystemFonts: true,
        disableFontFace: true,
        stopAtErrors: false, // continue past corrupt embedded images
      })
      .promise;

    const result: Array<{ pageNumber: number; base64: string }> = [];
    const PAGE_RENDER_TIMEOUT_MS = 30_000;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      if (pageFilter && !pageFilter.has(pageNum)) continue;

      try {
        const page = await pdfDoc.getPage(pageNum);
        // scale 1.5 → ~112 dpi; sufficient for Vision OCR, 44% less memory than 2.0
        const viewport = page.getViewport({ scale: 1.5 });

        const { canvas, context } = nodeCanvasFactory.create(
          Math.ceil(viewport.width),
          Math.ceil(viewport.height),
        );

        const renderTask = page.render({
          // The node-canvas object is compatible with HTMLCanvasElement at runtime
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        });

        // Race against a timeout so a corrupt JPEG cannot spin the CPU indefinitely
        await Promise.race([
          renderTask.promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              renderTask.cancel();
              reject(new Error(`timeout p${pageNum}`));
            }, PAGE_RENDER_TIMEOUT_MS),
          ),
        ]);

        result.push({ pageNumber: pageNum, base64: canvas.toBuffer('image/png').toString('base64') });
        page.cleanup();
        // Release canvas memory immediately — do not accumulate all pages
        (canvas as unknown as { width: number }).width = 0;
      } catch (err) {
        this.logger.warn(`Skipping page ${pageNum}: ${(err as Error).message}`);
      }
    }

    await pdfDoc.destroy();
    return result;
  }

  private async callVisionApi(pageImages: string[]): Promise<string> {
    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: 'Transcreva fielmente o conteúdo deste documento. Use o separador "---PAGE {N} END---" (onde N é o número da página) ao final de cada página:',
      },
      ...pageImages.map(
        (img): OpenAI.Chat.ChatCompletionContentPart => ({
          type: 'image_url' as const,
          image_url: {
            url: `data:image/png;base64,${img}`,
            detail: 'high',
          },
        }),
      ),
    ];

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'Você é especialista em leitura de Atestados de Capacidade Técnica (CAT) de obras de construção civil brasileiras.\n' +
            'Ao processar o documento, produza TRÊS seções na sua resposta:\n\n' +
            '1. Bloco de cabeçalho JSON entre os marcadores ===HEADER_JSON_START=== e ===HEADER_JSON_END===\n' +
            '   Formato: { "obra": "...", "contratante": "...", "contratada": "...", "cnpj": "...", "contrato": "...", ' +
            '"cidade": "...", "estado": "UF", "valor_obra": "...", "valor_atestado": "...", ' +
            '"data_atestado": "DD/MM/AAAA", "data_inicio": "DD/MM/AAAA", "data_fim": "DD/MM/AAAA", "engenheiro": "..." }\n\n' +
            '2. Tabela de serviços como CSV entre ===TABLE_CSV_START=== e ===TABLE_CSV_END===\n' +
            '   Cabeçalho obrigatório: codigo,descricao,unidade,quantidade,categoria\n' +
            '   - Linhas de categoria/seção (sem quantidade): coloque o nome da categoria em descricao e deixe codigo, unidade e quantidade em branco\n' +
            '   - NÃO inclua linhas de TOTAL, SUBTOTAL, SOMA ou resumo no CSV; omita-as completamente\n' +
            '   - Quantidade vazia ou "-": deixe em branco\n' +
            '   - Preserve números decimais com vírgula (ex: 1.234,56)\n' +
            '   - Não use aspas desnecessárias. Use aspas duplas apenas se o campo contiver vírgula\n\n' +
            '3. Transcrição fiel do texto restante, com separador "---PAGE {N} END---" ao final de cada página.',
        },
        { role: 'user', content: userContent },
      ],
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content ?? '';

    // Detect GPT-4o content-policy refusals and retry with a minimal fallback prompt
    if (this.isRefusal(content)) {
      this.logger.warn('GPT-4o Vision refused primary prompt — retrying with fallback prompt');
      return this.callVisionApiFallback(pageImages);
    }

    return content;
  }

  private isRefusal(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    const lower = text.toLowerCase();
    return (
      lower.includes("i'm sorry") ||
      lower.includes('i cannot assist') ||
      lower.includes("i can't assist") ||
      lower.includes("i can't help") ||
      lower.includes('i am unable to') ||
      lower.includes("i'm unable to")
    );
  }

  private async callVisionApiFallback(pageImages: string[]): Promise<string> {
    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      {
        type: 'text',
        text: 'Please transcribe all the text you can see in this document image, including tables, headers, and all fields. Output the raw text only.',
      },
      ...pageImages.map(
        (img): OpenAI.Chat.ChatCompletionContentPart => ({
          type: 'image_url' as const,
          image_url: { url: `data:image/png;base64,${img}`, detail: 'high' },
        }),
      ),
    ];

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content ?? '';
    if (this.isRefusal(content)) {
      this.logger.warn('GPT-4o Vision refused fallback prompt too — returning empty result');
      return '';
    }
    return content;
  }

  // ─── Per-page Vision path ────────────────────────────────────────────────────

  /**
   * Processes each PDF page individually with GPT-4o-mini Vision.
   * Per-page calls prevent token overflow and let the model understand
   * visual table structure (multi-line descriptions, column alignment).
   * Results are merged into the combined visionText expected by downstream parsers.
   */
  private async recognizeAndStructure(pageImages: string[]): Promise<string> {
    const pageTexts: string[] = [];
    for (let i = 0; i < pageImages.length; i++) {
      const text = await this.callSinglePageVision(pageImages[i], i + 1);
      pageTexts.push(text);
      this.logger.debug(`Vision page ${i + 1}/${pageImages.length}: ${text.length} chars`);
    }
    return this.mergePageVisionResults(pageTexts);
  }

  private async callSinglePageVision(
    base64Image: string,
    pageNum: number,
  ): Promise<string> {
    const model = this.config.get<string>('chatModel') ?? 'gpt-4o-mini';
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Extract Brazilian construction certificate data. Return ONLY two JSON blocks.\n' +
            '===HEADER_JSON_START===\n{ "obra":"string|null", "objeto":"string|null", "contratante":"string|null", "contratada":"string|null", "cnpj":"string|null", "cnpj_contratada":"string|null", "contrato":"string|null", "cidade":"string|null", "estado":"string|null", "local":"string|null", "data_atestado":"DD/MM/YYYY|null", "data_inicio":"DD/MM/YYYY|null", "data_fim":"DD/MM/YYYY|null", "engenheiro":"string|null", "titulo":"string|null" }\n===HEADER_JSON_END===\n' +
            '===ITEMS_JSON_START===\n{ "itens":[{ "codigo":"string|null", "descricao":"string", "categoria":"string|null", "unidade":"string|null", "quantidade_raw":"string|null", "baixa_confianca":false }] }\n===ITEMS_JSON_END===\n' +
            'For the header, capture objeto as the name or description of the project/work. A document title such as Declaracao de Conclusao de Obras is never the object. Explicitly capture the document end or completion date as data_fim, including labels such as data de conclusao, termino, fim dos servicos, or prazo final. ' +
            'A code N.0 without both unit and quantity is a category header: do not return it as an item and copy its text as categoria to every following item until the next such header. A code N.0 with both unit and quantity is a real item and must be returned. ' +
            'Return one flat item for every service row visible on this page. Never omit rows and never use comments, placeholders, ellipses, or phrases such as "additional items would follow". Repeat the textual category on EVERY item in that category. Remove a numeric prefix from categories: "2.0 POSTO" must be "POSTO". Never use a numeric value, 0, 00, total, or section number as categoria. Keep item codes such as 2.4 and 20.1. If no textual category is visible, set categoria to null. Exclude totals. Preserve quantidade_raw exactly as printed. Do not invent unreadable values; set them null and baixa_confianca=true.',
        },
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: 'Page ' + pageNum + ' of the document:' },
            {
              type: 'image_url' as const,
              image_url: {
                url: 'data:image/png;base64,' + base64Image,
                detail: 'high' as const,
              },
            },
          ],
        },
      ],
      max_tokens: 8192,
    });

    const content = response.choices[0]?.message?.content ?? '';
    if (this.isRefusal(content)) {
      this.logger.warn('GPT Vision refused page ' + pageNum + ' — skipping');
      return '---PAGE ' + pageNum + ' END---';
    }
    return content;
  }

  private mergePageVisionResults(pageTexts: string[]): string {
    const mergedHeader: Record<string, string> = {};
    const itens: unknown[] = [];
    const transcriptions: string[] = [];

    for (const text of pageTexts) {
      const header = this.parseHeaderBlock(text);
      for (const [key, value] of Object.entries(header)) {
        // The attestation date is commonly printed on the final certification page.
        // Keep other first-page metadata, but allow a later concrete attestation date.
        if (!mergedHeader[key] || (key === 'data_atestado' && this.isDateValue(value))) {
          mergedHeader[key] = value;
        }
      }

      try {
        const marker = /(?:===|###)\s*ITEMS_JSON_START(?:===)?\s*([\s\S]*?)\s*(?:===|###)\s*ITEMS_JSON_END(?:===)?/i.exec(text);
        const parsed = marker
          ? this.parseJsonObject(marker[1])
          : this.findJsonObject(text, (value) => Array.isArray(value.itens) || Array.isArray(value.items));
        const pageItems = parsed?.itens ?? parsed?.items;
        if (Array.isArray(pageItems)) itens.push(...pageItems);
      } catch {
        this.logger.warn('Failed to parse Vision items JSON');
      }

      const plain = text
        .replace(/(?:===|###)\s*HEADER_JSON_START(?:===)?[\s\S]*?(?:===|###)\s*HEADER_JSON_END(?:===)?/gi, '')
        .replace(/(?:===|###)\s*ITEMS_JSON_START(?:===)?[\s\S]*?(?:===|###)\s*ITEMS_JSON_END(?:===)?/gi, '')
        .trim();
      if (plain) transcriptions.push(plain);
    }

    const headerBlock = Object.keys(mergedHeader).length
      ? '===HEADER_JSON_START===\n' + JSON.stringify(mergedHeader) + '\n===HEADER_JSON_END==='
      : '';
    const itemsBlock = '===ITEMS_JSON_START===\n' + JSON.stringify({ itens }) + '\n===ITEMS_JSON_END===';
    return [headerBlock, itemsBlock, transcriptions.join('\n\n')].filter(Boolean).join('\n\n');
  }

  private parseHeaderBlock(text: string): Record<string, string> {
    const match = /(?:===|###)\s*HEADER_JSON_START(?:===)?\s*([\s\S]*?)\s*(?:===|###)\s*HEADER_JSON_END(?:===)?/i.exec(text);
    try {
      const parsed = match
        ? this.parseJsonObject(match[1])
        : this.findJsonObject(text, (value) => 'obra' in value || 'titulo' in value || 'contratante' in value);
      if (!parsed) return {};

      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'string' && v.trim()) result[k] = v.trim();
      }
      return result;
    } catch {
      this.logger.warn('Failed to parse Vision header JSON block');
      return {};
    }
  }

  private parseTableBlock(text: string, inheritedCategory?: string): OcrResult['rawServiceRows'] {
    try {
      const match = /(?:===|###)\s*ITEMS_JSON_START(?:===)?\s*([\s\S]*?)\s*(?:===|###)\s*ITEMS_JSON_END(?:===)?/i.exec(text);
      const parsed = match
        ? this.parseJsonObject(match[1])
        : this.findJsonObject(text, (value) => Array.isArray(value.itens) || Array.isArray(value.items));
      if (!parsed) return undefined;

      const items = this.arrayOfRecords(parsed.itens ?? parsed.items);
      const rows: NonNullable<OcrResult['rawServiceRows']> = [];
      let currentCategory = inheritedCategory;

      for (const item of items) {
        const descricao = this.readText(item.descricao ?? item.description);
        if (!descricao) continue;
        const codigo = this.readText(item.codigo ?? item.code);
        const categoria = this.readText(item.categoria ?? item.category);
        const unidade = this.readText(item.unidade ?? item.unit);
        const quantidadeRaw = this.readText(item.quantidade_raw ?? item.quantidadeRaw ?? item.quantidade ?? item.quantity);
        // N.0 without unit and quantity is a category header. N.0 with both
        // values is a legitimate item and must be retained.
        if (!unidade && !quantidadeRaw && /^\d+\.0$/.test(codigo ?? '')) {
          currentCategory = categoria ?? descricao;
          continue;
        }
        const resolvedCategory = categoria ?? currentCategory;
        if (resolvedCategory) currentCategory = resolvedCategory;
        rows.push({
          categoria: resolvedCategory,
          codigo,
          descricao,
          unidade,
          quantidadeRaw,
          baixaConfianca: item.baixa_confianca === true || item.baixaConfianca === true || item.low_confidence === true,
        });
      }

      if (!rows.length) this.logger.warn('Vision JSON parsed successfully but contained no valid service rows');
      return rows.length ? rows : undefined;
    } catch (err) {
      this.logger.warn('Failed to parse Vision items JSON', err);
      return undefined;
    }
  }

  /**
   * Repairs invalid backslashes produced by OCR text (for example, c\vidro)
   * before parsing; valid JSON escapes remain untouched.
   */
  private parseJsonObject(value: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      const withoutComments = this.stripJsonLineComments(value);
      const repaired = withoutComments.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
      parsed = JSON.parse(repaired);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Vision JSON value is not an object');
    }
    return parsed as Record<string, unknown>;
  }

  /** Removes // comments outside JSON string values emitted by a model. */
  private stripJsonLineComments(value: string): string {
    let result = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (inString) {
        result += char;
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') {
        inString = true;
        result += char;
      } else if (char === '/' && value[i + 1] === '/') {
        while (i < value.length && value[i] !== '\n') i++;
        if (i < value.length) result += '\n';
      } else {
        result += char;
      }
    }
    return result;
  }

  /** Accepts valid JSON fenced by Markdown when the model omits our markers. */
  private findJsonObject(
    text: string,
    predicate: (value: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | undefined {
    const fence = String.fromCharCode(96).repeat(3);
    const candidates = [...text.matchAll(new RegExp(fence + '(?:json)?\\s*([\\s\\S]*?)' + fence, 'gi'))]
      .map((match) => match[1]);

    for (const candidate of candidates) {
      try {
        const value = this.parseJsonObject(candidate.trim());
        if (value && typeof value === 'object' && !Array.isArray(value) && predicate(value as Record<string, unknown>)) {
          return value as Record<string, unknown>;
        }
      } catch {
        // Try the next fenced block.
      }
    }
    return undefined;
  }

  private arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
  }

  private readText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private isDateValue(value: string): boolean {
    return /^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}$/.test(value.trim());
  }

  /** Minimal CSV line parser that handles double-quoted fields with commas. */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  }

  private removeStructuredBlocks(text: string): string {
    return text
      .replace(/===HEADER_JSON_START===[\s\S]*?===HEADER_JSON_END===/gi, '')
      .replace(/===ITEMS_JSON_START===[\s\S]*?===ITEMS_JSON_END===/gi, '')
      .trim();
  }

  private splitIntoPages(
    visionText: string,
  ): Array<{ pageNumber: number; text: string }> {
    // Match "---PAGE 1 END---", "---PAGE 2 END---", etc.
    const parts = visionText.split(/---PAGE\s+(\d+)\s+END---/i);
    const pages: Array<{ pageNumber: number; text: string }> = [];

    for (let i = 0; i < parts.length; i += 2) {
      const text = parts[i].trim();
      if (!text) continue;
      // The number following the matching text is at parts[i+1] (the capture group)
      const pageNumber = i === 0 ? 1 : parseInt(parts[i - 1], 10);
      pages.push({ pageNumber: isNaN(pageNumber) ? pages.length + 1 : pageNumber, text });
    }

    // Fallback: treat whole response as page 1
    if (pages.length === 0 && visionText.trim()) {
      pages.push({ pageNumber: 1, text: visionText.trim() });
    }

    return pages;
  }
}

// ─── TextractService ─────────────────────────────────────────────────────────
// Co-located with TextractTable / TextractCell type definitions.

/**
 * TextractService — AWS Textract async document analysis.
 * Last-resort fallback: called only when all Vision OCR paths return zero service rows.
 * Uses StartDocumentAnalysis (async, S3-based) which supports documents of any size.
 */
@Injectable()
export class TextractService {
  private readonly client: TextractClient;
  private readonly bucket: string;
  private readonly logger = new Logger(TextractService.name);

  constructor(private readonly config: ConfigService) {
    this.client = new TextractClient({
      region: config.get<string>('aws.region') ?? 'sa-east-1',
      credentials: {
        accessKeyId: config.get<string>('aws.accessKeyId') ?? '',
        secretAccessKey: config.get<string>('aws.secretAccessKey') ?? '',
      },
    });
    this.bucket = config.get<string>('aws.s3Bucket') ?? '';
  }

  async analyzeTables(s3Key: string): Promise<TextractTable[]> {
    const startResponse = await this.client.send(
      new StartDocumentAnalysisCommand({
        DocumentLocation: {
          S3Object: { Bucket: this.bucket, Name: s3Key },
        },
        FeatureTypes: ['TABLES'],
      }),
    );
    const jobId = startResponse.JobId;
    if (!jobId) throw new Error('Textract did not return a JobId');
    this.logger.log(`Textract job started: ${jobId} for s3://${this.bucket}/${s3Key}`);
    const blocks = await this.pollUntilComplete(jobId);
    return this.blocksToTables(blocks);
  }

  private async pollUntilComplete(jobId: string): Promise<Block[]> {
    const MAX_WAIT_MS = 5 * 60 * 1000;
    const POLL_INTERVAL_MS = 5_000;
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const response = await this.client.send(
        new GetDocumentAnalysisCommand({ JobId: jobId }),
      );
      if (response.JobStatus === 'FAILED') {
        throw new Error(`Textract job failed: ${response.StatusMessage ?? 'Unknown error'}`);
      }
      if (response.JobStatus === 'SUCCEEDED') {
        const allBlocks: Block[] = [...(response.Blocks ?? [])];
        let nextToken = response.NextToken;
        while (nextToken) {
          const page = await this.client.send(
            new GetDocumentAnalysisCommand({ JobId: jobId, NextToken: nextToken }),
          );
          allBlocks.push(...(page.Blocks ?? []));
          nextToken = page.NextToken;
        }
        this.logger.log(`Textract job ${jobId} completed: ${allBlocks.length} blocks`);
        return allBlocks;
      }
      // JobStatus === 'IN_PROGRESS' — continue polling
    }
    throw new Error(`Textract job timed out after 5 minutes (jobId=${jobId})`);
  }

  private blocksToTables(blocks: Block[]): TextractTable[] {
    const blockMap = new Map<string, Block>(
      blocks.filter((b) => b.Id).map((b) => [b.Id!, b]),
    );
    const tableBlocks = blocks.filter((b) => b.BlockType === 'TABLE');
    this.logger.log(`Textract blocksToTables: ${tableBlocks.length} TABLE blocks from ${blocks.length} total blocks`);
    return tableBlocks.map((table) => {
      const directChildIds =
        table.Relationships?.filter((r) => r.Type === 'CHILD').flatMap((r) => r.Ids ?? []) ?? [];
      // Resolve MERGED_CELL blocks: their component CELLs may not be direct TABLE children
      const allCellIds: string[] = [];
      for (const id of directChildIds) {
        const block = blockMap.get(id);
        if (block?.BlockType === 'CELL') {
          allCellIds.push(id);
        } else if (block?.BlockType === 'MERGED_CELL') {
          const mergedChildIds =
            block.Relationships?.filter((r) => r.Type === 'CHILD').flatMap((r) => r.Ids ?? []) ?? [];
          allCellIds.push(...mergedChildIds);
        }
      }
      const cells: TextractCell[] = allCellIds
        .map((id) => blockMap.get(id))
        .filter(
          (b): b is Block =>
            b?.BlockType === 'CELL' && b.RowIndex != null && b.ColumnIndex != null,
        )
        .map((cell) => {
          const wordIds =
            cell.Relationships?.filter((r) => r.Type === 'CHILD').flatMap((r) => r.Ids ?? []) ?? [];
          const text = wordIds
            .map((id) => blockMap.get(id))
            .filter((b): b is Block => b?.BlockType === 'WORD' || b?.BlockType === 'LINE')
            .map((b) => b.Text ?? '')
            .join(' ');
          return {
            rowIndex: cell.RowIndex! - 1,
            colIndex: cell.ColumnIndex! - 1,
            rowSpan: cell.RowSpan ?? 1,
            colSpan: cell.ColumnSpan ?? 1,
            text,
            confidence: cell.Confidence ?? 0,
          };
        });
      const maxRow = cells.reduce((m, c) => Math.max(m, c.rowIndex + c.rowSpan), 0);
      const maxCol = cells.reduce((m, c) => Math.max(m, c.colIndex + c.colSpan), 0);
      return { page: table.Page ?? 1, cells, rows: maxRow, cols: maxCol };
    });
  }
}
