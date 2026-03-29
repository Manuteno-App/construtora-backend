import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { OcrService } from '../services/ocr.service';
import { TableExtractorService } from '../services/table-extractor.service';
import { VisionService } from '../services/vision.service';
import { Atestado, AtestadoStatus } from '../../database/entities/atestado.entity';
import { Chunk } from '../../database/entities/chunk.entity';
import { EXTRACTION_QUEUE, INGESTION_QUEUE } from '../../queue/queue.module';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

const TARGET_CHUNK_TOKENS = 512;
const CHUNK_OVERLAP_TOKENS = 50;

export interface IngestionJobPayload {
  atestadoId: string;
}

@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly tableExtractor: TableExtractorService,
    private readonly vision: VisionService,
    @InjectRepository(Atestado)
    private readonly atestadoRepo: Repository<Atestado>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    @InjectQueue(EXTRACTION_QUEUE)
    private readonly extractionQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<IngestionJobPayload>): Promise<void> {
    const { atestadoId } = job.data;
    this.logger.log(`Processing ingestion for atestado ${atestadoId}`);

    const atestado = await this.atestadoRepo.findOneOrFail({ where: { id: atestadoId } });

    try {
      await this.atestadoRepo.update(atestadoId, { status: AtestadoStatus.PROCESSING });

      // 1. Download from S3
      const signedUrl = await this.storage.getSignedUrl(atestado.s3Key);
      const response = await fetch(signedUrl);
      const buffer = Buffer.from(await response.arrayBuffer());

      // 2. Extract text (native PDF first, OCR fallback)
      let fullText = '';
      let pages: Array<{ pageNumber: number; text: string }> = [];

      try {
        const parsed = await pdfParse(buffer);
        fullText = (parsed.text as string).trim();
        // Split into rough pages using form-feed characters
        const rawPages = (parsed.text as string).split('\f');
        pages = rawPages.map((t, i) => ({ pageNumber: i + 1, text: t }));
        const sparsePages = pages.filter((p) => p.text.trim().length < 100).length;
        this.logger.log(
          `pdf-parse: ${pages.length} pages, ${fullText.length} chars, ${sparsePages} sparse pages for ${atestadoId}`,
        );
      } catch {
        this.logger.warn(`pdf-parse failed for ${atestadoId}, falling back to OCR`);
      }

      // 3. Scanned or mixed PDF path: Textract AnalyzeDocument (TABLES + FORMS)
      // Trigger OCR when: no text, too little text, or >30% of pages are near-empty
      // (sparse pages indicate scanned pages that pdf-parse cannot read)
      const sparseRatio = pages.length > 0
        ? pages.filter((p) => p.text.trim().length < 100).length / pages.length
        : 1;
      const needsOcr = !fullText || fullText.length < 100 || (pages.length > 1 && sparseRatio > 0.3);
      if (needsOcr) {
        this.logger.log(
          `Using Textract OCR for ${atestadoId} (fullText=${fullText.length} chars, sparseRatio=${sparseRatio.toFixed(2)})`,
        );
      }
      let keyValuePairs: Record<string, string> = {};
      if (needsOcr) {
        let ocrResult = await this.ocr.extractText(buffer);
        // Vision fallback for low-confidence pages
        ocrResult = await this.vision.analyzeIfNeeded(buffer, ocrResult);
        fullText = ocrResult.text;
        pages = ocrResult.pages;
        keyValuePairs = ocrResult.keyValuePairs;

        // 4a. Extract structured service rows from Textract TABLE blocks
        const tabelaServicos = this.tableExtractor.extractBest(ocrResult);

        fullText = this.preProcess(fullText);
        const chunks = this.buildChunks(fullText, pages, atestado.originalFilename);
        const savedChunks = this.chunkRepo.create(
          chunks.map((c, i) => ({
            atestadoId,
            originalFilename: atestado.originalFilename,
            content: c.content,
            chunkIndex: i,
            pageNumber: c.pageNumber,
          })),
        );
        await this.chunkRepo.save(savedChunks);

        await this.extractionQueue.add('extract-entities', {
          atestadoId,
          chunkIds: savedChunks.map((c) => c.id),
          tabelaServicos,
          keyValuePairs,
        });
        this.logger.log(
          `Ingestion done for ${atestadoId}: ${savedChunks.length} chunks, ${tabelaServicos.length} servicos (Textract)`,
        );
        return;
      }

      // 4b. Native PDF path: regex-based table extraction from text
      fullText = this.preProcess(fullText);
      const tabelaServicos = this.tableExtractor.extract(fullText);

      // 5. Semantic chunking of narrative text
      const chunks = this.buildChunks(fullText, pages, atestado.originalFilename);

      // 6. Persist chunks
      const savedChunks = this.chunkRepo.create(
        chunks.map((c, i) => ({
          atestadoId,
          originalFilename: atestado.originalFilename,
          content: c.content,
          chunkIndex: i,
          pageNumber: c.pageNumber,
        })),
      );
      await this.chunkRepo.save(savedChunks);

      // 7. Enqueue extraction job
      await this.extractionQueue.add('extract-entities', {
        atestadoId,
        chunkIds: savedChunks.map((c) => c.id),
        tabelaServicos,
        keyValuePairs,
      });

      this.logger.log(
        `Ingestion done for ${atestadoId}: ${savedChunks.length} chunks, ${tabelaServicos.length} servicos`,
      );
    } catch (err) {
      this.logger.error(`Ingestion failed for ${atestadoId}`, err);
      await this.atestadoRepo.update(atestadoId, {
        status: AtestadoStatus.ERROR,
        errorMessage: String(err),
      });
      throw err;
    }
  }

  private preProcess(text: string): string {
    return text
      .normalize('NFC')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private buildChunks(
    text: string,
    pages: Array<{ pageNumber: number; text: string }>,
    filename: string,
  ): Array<{ content: string; pageNumber: number }> {
    // Simple paragraph-based chunking with approximate token counting (1 token ≈ 4 chars)
    const paragraphs = text.split(/\n\n+/);
    const result: Array<{ content: string; pageNumber: number }> = [];
    let current = '';
    let currentPage = 1;

    const approxTokens = (s: string) => Math.ceil(s.length / 4);

    for (const para of paragraphs) {
      if (!para.trim()) continue;

      // Determine page number for this paragraph
      const paraPage = this.findPageForText(para, pages) ?? currentPage;

      if (approxTokens(current + '\n\n' + para) > TARGET_CHUNK_TOKENS && current) {
        result.push({ content: current.trim(), pageNumber: currentPage });
        // Overlap: keep last CHUNK_OVERLAP_TOKENS worth of characters
        const overlapChars = CHUNK_OVERLAP_TOKENS * 4;
        current = current.slice(-overlapChars) + '\n\n' + para;
        currentPage = paraPage;
      } else {
        current = current ? current + '\n\n' + para : para;
        currentPage = paraPage;
      }
    }

    if (current.trim()) {
      result.push({ content: current.trim(), pageNumber: currentPage });
    }

    return result.length > 0 ? result : [{ content: text.slice(0, 2000), pageNumber: 1 }];
  }

  private findPageForText(
    text: string,
    pages: Array<{ pageNumber: number; text: string }>,
  ): number | undefined {
    const snippet = text.slice(0, 50);
    for (const p of pages) {
      if (p.text.includes(snippet)) return p.pageNumber;
    }
    return undefined;
  }
}
