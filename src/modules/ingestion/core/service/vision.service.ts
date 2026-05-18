import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

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
    quantidade?: string;
    categoria?: string;
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
  async analyze(buffer: Buffer): Promise<OcrResult> {
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
      const pageImages = await this.renderPdfPages(buffer);
      if (pageImages.length === 0) return empty;

      let visionText: string;
      if (this.tesseractLib) {
        try {
          visionText = await this.recognizeAndStructure(pageImages);
        } catch (err) {
          this.logger.warn('Tesseract OCR failed, falling back to GPT-4o Vision', err);
          visionText = await this.callVisionApi(pageImages);
        }
      } else {
        visionText = await this.callVisionApi(pageImages);
      }

      // Extract structured blocks before splitting into pages
      const keyValuePairs = this.parseHeaderBlock(visionText);
      const rawServiceRows = this.parseTableBlock(visionText);
      const cleanText = this.removeStructuredBlocks(visionText);
      const pages = this.splitIntoPages(cleanText);

      return {
        text: pages.map((p) => p.text).join('\n\n'),
        pages,
        tables: [],
        keyValuePairs,
        avgConfidence: 100,
        rawServiceRows,
      };
    } catch (err) {
      this.logger.error('Vision analysis failed', err);
      return empty;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async renderPdfPages(buffer: Buffer): Promise<string[]> {
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
      })
      .promise;

    const images: string[] = [];

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      // scale 2.0 → ~150 dpi, good balance of quality vs token cost
      const viewport = page.getViewport({ scale: 2.0 });

      const { canvas, context } = nodeCanvasFactory.create(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );

      await page.render({
        // The node-canvas object is compatible with HTMLCanvasElement at runtime
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      images.push(canvas.toBuffer('image/png').toString('base64'));
      page.cleanup();
    }

    await pdfDoc.destroy();
    return images;
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
            '   - Linhas de categoria/seção (sem quantidade): deixe unidade e quantidade em branco\n' +
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

  // ─── Tesseract + GPT-mini path ───────────────────────────────────────────────

  /**
   * Recognizes text with Tesseract OCR (local, free) then uses GPT-4o-mini
   * to extract a structured header JSON + service CSV from the raw OCR text.
   * Significantly cheaper than GPT-4o Vision per page.
   */
  private async recognizeAndStructure(pageImages: string[]): Promise<string> {
    const pageTexts = await this.recognizeWithTesseract(pageImages);

    // Raw transcription with page separators — consumed by splitIntoPages
    const rawWithSeparators = pageTexts
      .map((t, i) => `${t.trim()}\n---PAGE ${i + 1} END---`)
      .join('\n\n');

    // GPT-mini extracts structured blocks from the OCR text
    const structured = await this.structureWithGpt(
      pageTexts.map((t, i) => `[Página ${i + 1}]\n${t.trim()}`).join('\n\n'),
    );

    // Combine: structured blocks first, then raw OCR — downstream parsers consume both
    return `${structured}\n\n${rawWithSeparators}`;
  }

  private async recognizeWithTesseract(pageImages: string[]): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const langPath = (require('path') as typeof import('path')).resolve(process.cwd());

    const worker = await this.tesseractLib!.createWorker('por', 1, {
      langPath,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') {
          this.logger.verbose(`Tesseract: ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    const texts: string[] = [];
    for (let i = 0; i < pageImages.length; i++) {
      const imgBuffer = Buffer.from(pageImages[i], 'base64');
      const { data: { text } } = await worker.recognize(imgBuffer);
      texts.push(text);
      this.logger.debug(
        `Tesseract page ${i + 1}/${pageImages.length}: ${text.trim().length} chars`,
      );
    }

    await worker.terminate();
    return texts;
  }

  private async structureWithGpt(rawText: string): Promise<string> {
    const model = this.config.get<string>('chatModel') ?? 'gpt-4o-mini';
    const response = await this.openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'Você é especialista em leitura de Atestados de Capacidade Técnica (CAT) de obras de construção civil brasileiras.\n' +
            'Com base no texto OCR fornecido, produza DUAS seções na sua resposta:\n\n' +
            '1. Bloco de cabeçalho JSON entre os marcadores ===HEADER_JSON_START=== e ===HEADER_JSON_END===\n' +
            '   Formato: { "obra": "...", "contratante": "...", "contratada": "...", "cnpj": "...", "contrato": "...", ' +
            '"cidade": "...", "estado": "UF", "valor_obra": "...", "valor_atestado": "...", ' +
            '"data_atestado": "DD/MM/AAAA", "data_inicio": "DD/MM/AAAA", "data_fim": "DD/MM/AAAA", "engenheiro": "..." }\n\n' +
            '2. Tabela de serviços como CSV entre ===TABLE_CSV_START=== e ===TABLE_CSV_END===\n' +
            '   Cabeçalho obrigatório: codigo,descricao,unidade,quantidade,categoria\n' +
            '   - Linhas de categoria/seção (sem quantidade): deixe unidade e quantidade em branco\n' +
            '   - Quantidade vazia ou "-": deixe em branco\n' +
            '   - Preserve números decimais com vírgula (ex: 1.234,56)\n' +
            '   - Não use aspas desnecessárias. Use aspas duplas apenas se o campo contiver vírgula\n\n' +
            'Se algum campo não estiver presente no texto, omita-o do JSON (não inclua null ou string vazia).',
        },
        {
          role: 'user',
          content: `Texto OCR extraído do atestado:\n\n${rawText}`,
        },
      ],
      max_tokens: 4096,
    });
    return response.choices[0]?.message?.content ?? '';
  }

  private parseHeaderBlock(text: string): Record<string, string> {
    const match = /===HEADER_JSON_START===\s*([\s\S]*?)\s*===HEADER_JSON_END===/i.exec(text);
    if (!match) return {};
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
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

  private parseTableBlock(
    text: string,
  ): OcrResult['rawServiceRows'] {
    const match = /===TABLE_CSV_START===\s*([\s\S]*?)\s*===TABLE_CSV_END===/i.exec(text);
    if (!match) return undefined;

    const lines = match[1].split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return undefined;

    // Parse CSV header
    const header = this.parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
    const codigoIdx    = header.indexOf('codigo');
    const descricaoIdx = header.indexOf('descricao');
    const unidadeIdx   = header.indexOf('unidade');
    const quantidadeIdx = header.indexOf('quantidade');
    const categoriaIdx = header.indexOf('categoria');

    if (descricaoIdx === -1) return undefined;

    const rows: NonNullable<OcrResult['rawServiceRows']> = [];
    let currentCategory = 'GERAL';

    for (const line of lines.slice(1)) {
      const cols = this.parseCsvLine(line);
      const descricao = cols[descricaoIdx]?.trim() ?? '';
      if (!descricao) continue;

      const quantidade = cols[quantidadeIdx]?.trim() ?? '';
      const unidade    = cols[unidadeIdx]?.trim() ?? '';

      // Row without quantity → category/subcategory
      if (!quantidade || quantidade === '-') {
        currentCategory = descricao;
        continue;
      }

      rows.push({
        codigo:     codigoIdx   >= 0 ? (cols[codigoIdx]?.trim()   || undefined) : undefined,
        descricao,
        unidade:    unidade || undefined,
        quantidade: quantidade || undefined,
        categoria:  categoriaIdx >= 0 ? (cols[categoriaIdx]?.trim() || currentCategory) : currentCategory,
      });
    }

    return rows.length > 0 ? rows : undefined;
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
      .replace(/===TABLE_CSV_START===[\s\S]*?===TABLE_CSV_END===/gi, '')
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
