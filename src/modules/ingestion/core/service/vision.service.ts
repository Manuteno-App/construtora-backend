import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { OcrResult } from './ocr.service';

// Dynamic imports used to avoid hard dependency at module load time
type CanvasLib = typeof import('canvas');
type PdfjsLib = typeof import('pdfjs-dist');

/**
 * VisionService — GPT-4o Vision fallback for low-confidence scanned PDFs.
 *
 * Requires pdfjs-dist and canvas to be installed:
 *   npm install pdfjs-dist canvas
 *
 * The service gracefully degrades: if those packages are unavailable, it logs
 * a warning and skips the vision analysis.
 */
@Injectable()
export class VisionService implements OnModuleInit {
  private readonly logger = new Logger(VisionService.name);
  private readonly openai: OpenAI;

  private canvasLib: CanvasLib | null = null;
  private pdfjsLib: PdfjsLib | null = null;

  /** Minimum average Textract confidence (0–100) below which Vision is triggered */
  private static readonly CONFIDENCE_THRESHOLD = 80;

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
  }

  isAvailable(): boolean {
    return this.canvasLib !== null && this.pdfjsLib !== null;
  }

  /**
   * Re-analyses the document with GPT-4o Vision when Textract confidence is low.
   * Returns an enriched OcrResult with corrected text; tables and keyValuePairs
   * from Textract are preserved as they are structurally reliable.
   */
  async analyzeIfNeeded(
    buffer: Buffer,
    existingResult: OcrResult,
  ): Promise<OcrResult> {
    if (!this.isAvailable()) return existingResult;

    if (existingResult.avgConfidence >= VisionService.CONFIDENCE_THRESHOLD) {
      this.logger.debug(
        `Textract confidence ${existingResult.avgConfidence.toFixed(1)}% — Vision not needed`,
      );
      return existingResult;
    }

    this.logger.log(
      `Low OCR confidence (${existingResult.avgConfidence.toFixed(1)}%) — running GPT-4o Vision`,
    );

    try {
      const pageImages = await this.renderPdfPages(buffer);
      if (pageImages.length === 0) return existingResult;

      const visionText = await this.callVisionApi(pageImages);
      const visionPages = this.splitIntoPages(visionText);

      return {
        ...existingResult,
        text: visionPages.map((p) => p.text).join('\n\n'),
        pages: visionPages.length > 0 ? visionPages : existingResult.pages,
        // Keep Textract's structured tables and key-value pairs
      };
    } catch (err) {
      this.logger.warn('Vision analysis failed — keeping Textract result', err);
      return existingResult;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async renderPdfPages(buffer: Buffer): Promise<string[]> {
    const { createCanvas } = this.canvasLib!;
    const pdfjsLib = this.pdfjsLib!;

    // Disable the web worker — we render synchronously in Node.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    const nodeCanvasFactory = {
      create(width: number, height: number) {
        const canvas = createCanvas(width, height);
        return { canvas, context: canvas.getContext('2d') };
      },
      reset(
        obj: { canvas: ReturnType<CanvasLib['createCanvas']> },
        width: number,
        height: number,
      ) {
        obj.canvas.width = width;
        obj.canvas.height = height;
      },
      destroy(obj: { canvas: ReturnType<CanvasLib['createCanvas']> }) {
        obj.canvas.width = 0;
        obj.canvas.height = 0;
      },
    };

    const pdfDoc = await pdfjsLib
      .getDocument({
        data: new Uint8Array(buffer),
        CanvasFactory: nodeCanvasFactory as unknown as object,
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
            'Você é especialista em leitura de certidões de obras de construção civil (CAT) do Brasil. ' +
            'Extraia fielmente todo o texto, preservando:\n' +
            '- Cabeçalho: Contratante, Empreiteira, CNPJ, Contrato, Localização, Valor dos Serviços, Período\n' +
            '- Tabelas de NATUREZA DOS SERVIÇOS com colunas UNIDADE e QUANTIDADE\n' +
            '- Categorias em maiúsculas (ex: TERRAPLENAGEM, PAVIMENTAÇÃO DO SISTEMA VIÁRIO)\n' +
            'Preserve números decimais com vírgula (ex: 1.234,56). ' +
            'Separe as páginas com "---PAGE {N} END---".',
        },
        { role: 'user', content: userContent },
      ],
      max_tokens: 4096,
    });

    return response.choices[0]?.message?.content ?? '';
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
