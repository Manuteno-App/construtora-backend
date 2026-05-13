import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AtestadoStatus } from '../../documents/persistence/entity/atestado.entity';
import { DOCUMENTS_API, IDocumentsApi } from '../../documents/public-api/interface/documents-api.interface';
import { EXTRACTION_QUEUE, INGESTION_QUEUE } from '../../infrastructure/queue/queue.module';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { TableExtractorService } from '../core/service/table-extractor.service';
import { VisionService } from '../core/service/vision.service';
import { ChunkRepository, CreateChunkData } from '../persistence/repository/chunk.repository';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

const TARGET_CHUNK_TOKENS = 800;
const CHUNK_OVERLAP_TOKENS = 75;

export interface IngestionJobPayload {
  atestadoId: string;
}

@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly storage: StorageService,
    private readonly tableExtractor: TableExtractorService,
    private readonly vision: VisionService,
    private readonly chunkRepo: ChunkRepository,
    @Inject(DOCUMENTS_API) private readonly documentsApi: IDocumentsApi,
    @InjectQueue(EXTRACTION_QUEUE) private readonly extractionQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<IngestionJobPayload>): Promise<void> {
    const { atestadoId } = job.data;
    this.logger.log(`Processing ingestion for atestado ${atestadoId}`);

    const atestado = await this.documentsApi.findAtestadoById(atestadoId);
    if (!atestado) throw new Error(`Atestado ${atestadoId} not found`);

    try {
      await this.documentsApi.updateAtestadoStatus(atestadoId, AtestadoStatus.PROCESSING);

      const signedUrl = await this.storage.getSignedUrl(atestado.s3Key);
      const response = await fetch(signedUrl);
      const buffer = Buffer.from(await response.arrayBuffer());

      let fullText = '';
      let pages: Array<{ pageNumber: number; text: string }> = [];

      try {
        const parsed = await pdfParse(buffer);
        fullText = (parsed.text as string).trim();
        const rawPages = (parsed.text as string).split('\f');
        pages = rawPages.map((t, i) => ({ pageNumber: i + 1, text: t }));
        const sparsePages = pages.filter((p) => p.text.trim().length < 100).length;
        this.logger.log(
          `pdf-parse: ${pages.length} pages, ${fullText.length} chars, ${sparsePages} sparse pages for ${atestadoId}`,
        );
      } catch {
        this.logger.warn(`pdf-parse failed for ${atestadoId}, falling back to OCR`);
      }

      const sparseRatio = pages.length > 0
        ? pages.filter((p) => p.text.trim().length < 100).length / pages.length
        : 1;
      const needsOcr = !fullText || fullText.length < 100 || (pages.length > 1 && sparseRatio > 0.3);

      let keyValuePairs: Record<string, string> = {};

      if (needsOcr) {
        this.logger.log(
          `Using Vision OCR for ${atestadoId} (fullText=${fullText.length} chars, sparseRatio=${sparseRatio.toFixed(2)})`,
        );
        const ocrResult = await this.vision.analyze(buffer);
        fullText = ocrResult.text;
        pages = ocrResult.pages;
        keyValuePairs = ocrResult.keyValuePairs;

        const tabelaServicos = this.tableExtractor.extractBest(ocrResult);
        fullText = this.preProcess(fullText);
        const chunks = this.buildChunks(fullText, pages, atestado.originalFilename, keyValuePairs);
        const savedChunks = await this.chunkRepo.saveMany(
          chunks.map((c, i): CreateChunkData => ({
            atestadoId,
            originalFilename: atestado.originalFilename,
            content: c.content,
            chunkIndex: i,
            pageNumber: c.pageNumber,
          })),
        );

        await this.extractionQueue.add('extract-entities', {
          atestadoId,
          chunkIds: savedChunks.map((c) => c.id),
          tabelaServicos,
          keyValuePairs,
        });
        this.logger.log(
          `Ingestion done for ${atestadoId}: ${savedChunks.length} chunks, ${tabelaServicos.length} servicos (Vision)`,
        );
        return;
      }

      fullText = this.preProcess(fullText);
      const tabelaServicos = this.tableExtractor.extract(fullText);
      const chunks = this.buildChunks(fullText, pages, atestado.originalFilename, keyValuePairs);
      const savedChunks = await this.chunkRepo.saveMany(
        chunks.map((c, i): CreateChunkData => ({
          atestadoId,
          originalFilename: atestado.originalFilename,
          content: c.content,
          chunkIndex: i,
          pageNumber: c.pageNumber,
        })),
      );

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
      await this.documentsApi.updateAtestadoStatus(atestadoId, AtestadoStatus.ERROR, String(err));
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
    metadata?: Record<string, string>,
  ): Array<{ content: string; pageNumber: number }> {
    // Build a metadata header to prepend to each chunk so the embedding
    // captures document-level context (filename, obra, location, company).
    const metaParts: string[] = [`Arquivo: ${filename}`];
    if (metadata) {
      const keys: Array<[string, string]> = [
        ['nome_obra', 'Obra'],
        ['obra', 'Obra'],
        ['local', 'Local'],
        ['localidade', 'Local'],
        ['estado', 'Estado'],
        ['empresa_contratante', 'Contratante'],
        ['contratante', 'Contratante'],
        ['empresa_contratada', 'Contratada'],
        ['contratada', 'Contratada'],
      ];
      for (const [key, label] of keys) {
        const val = metadata[key];
        if (val) metaParts.push(`${label}: ${val}`);
      }
    }
    const metaHeader = `[${metaParts.join(' | ')}]`;

    const paragraphs = text.split(/\n\n+/);
    const result: Array<{ content: string; pageNumber: number }> = [];
    let current = '';
    let currentPage = 1;

    const approxTokens = (s: string) => Math.ceil(s.length / 4);

    for (const para of paragraphs) {
      if (!para.trim()) continue;
      const paraPage = this.findPageForText(para, pages) ?? currentPage;

      if (approxTokens(current + '\n\n' + para) > TARGET_CHUNK_TOKENS && current) {
        result.push({ content: `${metaHeader}\n${current.trim()}`, pageNumber: currentPage });
        const overlapChars = CHUNK_OVERLAP_TOKENS * 4;
        current = current.slice(-overlapChars) + '\n\n' + para;
        currentPage = paraPage;
      } else {
        current = current ? current + '\n\n' + para : para;
        currentPage = paraPage;
      }
    }

    if (current.trim()) {
      result.push({ content: `${metaHeader}\n${current.trim()}`, pageNumber: currentPage });
    }

    return result.length > 0 ? result : [{ content: `${metaHeader}\n${text.slice(0, 2000)}`, pageNumber: 1 }];
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
