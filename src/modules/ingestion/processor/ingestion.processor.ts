import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AtestadoStatus } from '../../documents/persistence/entity/atestado.entity';
import { DOCUMENTS_API, IDocumentsApi } from '../../documents/public-api/interface/documents-api.interface';
import { EXTRACTION_QUEUE, INGESTION_QUEUE } from '../../infrastructure/queue/queue.module';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { TableExtractorService } from '../core/service/table-extractor.service';
import { ServicoItem } from '../core/service/table-extractor.service';
import { TextractService, VisionService } from '../core/service/vision.service';
import { ChunkRepository, CreateChunkData } from '../persistence/repository/chunk.repository';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

const TARGET_CHUNK_TOKENS = 800;
const CHUNK_OVERLAP_TOKENS = 75;
/** Minimum characters for a page to be considered adequately extracted by pdf-parse.
 *  Pages below this threshold are treated as sparse (likely scanned) and sent to Vision OCR. */
const SPARSE_PAGE_THRESHOLD = 300;

/** Regex patterns to extract header key-value hints from raw PDF text. */
const HEADER_PATTERNS: Array<[string, RegExp]> = [
  ['obra',          /(?:obra|projeto|objeto)[:\s]+([^\n]{5,120})/i],
  ['contratante',   /(?:contratante|cliente|tomador)[:\s]+([^\n]{5,100})/i],
  ['contratada',    /(?:contratada|empreiteira|executora)[:\s]+([^\n]{5,100})/i],
  ['contrato',      /(?:contrato|n[uú]mero|n[º°.])\s*[:\s.°#]*\s*([A-Z0-9][A-Z0-9/.\-]{2,30})/i],
  ['valor_obra',    /(?:valor total|valor da obra|valor global)[:\s]+R?\$?\s*([\d.,]+)/i],
  ['valor_atestado',/(?:valor atestado|valor dos servi[cç]os)[:\s]+R?\$?\s*([\d.,]+)/i],
  ['engenheiro',    /(?:engenheiro|resp[.\s]*t[eé]cnico|responsável)[:\s]+([^\n]{5,80})/i],
  ['cidade',        /(?:munic[ií]pio|cidade)[:\s]+([^\n,]{3,60})/i],
  ['estado',        /\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/],
  ['data_atestado', /(?:data|emitido em|emiss[ãa]o)[:\s]+(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})/i],
];

export interface IngestionJobPayload {
  atestadoId: string;
}

// 30-minute lock: Vision OCR on large PDFs (100+ pages × per-page GPT calls) can
// take 10-20 min. Without a long lockDuration BullMQ marks the job as stalled and
// requeues it before it finishes, causing duplicate processing.
@Processor(INGESTION_QUEUE, { lockDuration: 1_800_000 })
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly storage: StorageService,
    private readonly tableExtractor: TableExtractorService,
    private readonly vision: VisionService,
    private readonly textract: TextractService,
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
        const sparsePages = pages.filter((p) => p.text.trim().length < SPARSE_PAGE_THRESHOLD).length;
        this.logger.log(
          `pdf-parse: ${pages.length} pages, ${fullText.length} chars, ${sparsePages} sparse pages (< ${SPARSE_PAGE_THRESHOLD} chars) for ${atestadoId}`,
        );
      } catch {
        this.logger.warn(`pdf-parse failed for ${atestadoId}, falling back to OCR`);
      }

      const sparsePageNums = pages
        .filter((p) => p.text.trim().length < SPARSE_PAGE_THRESHOLD)
        .map((p) => p.pageNumber);
      const sparseRatio = pages.length > 0 ? sparsePageNums.length / pages.length : 1;
      // Full OCR: no text at all, OR every page is sparse
      const noText = !fullText || fullText.length < 100;
      const allSparse = noText || sparsePageNums.length === pages.length;
      // Hybrid OCR: at least one page is sparse but not all (mixed digital + scanned)
      const hasSparsePages = !allSparse && sparsePageNums.length > 0;

      let keyValuePairs: Record<string, string> = {};
      let tabelaServicos: ServicoItem[] = [];

      if (allSparse) {
        this.logger.log(
          `Using Vision OCR (full) for ${atestadoId} (fullText=${fullText.length} chars, sparseRatio=${sparseRatio.toFixed(2)})`,
        );
        const ocrResult = await this.vision.analyze(buffer);
        fullText = ocrResult.text;
        pages = ocrResult.pages;
        keyValuePairs = ocrResult.keyValuePairs;
        tabelaServicos = this.tableExtractor.extractBest(ocrResult);
        fullText = this.preProcess(fullText);
      } else if (hasSparsePages) {
        this.logger.log(
          `Using Vision OCR (hybrid: ${sparsePageNums.length}/${pages.length} pages) for ${atestadoId}`,
        );
        const ocrResult = await this.vision.analyzeSelectivePages(buffer, sparsePageNums);
        const ocrPageMap = new Map(ocrResult.pages.map((p) => [p.pageNumber, p.text]));
        const mergedPages = pages.map((p) => ({
          pageNumber: p.pageNumber,
          text: ocrPageMap.has(p.pageNumber) ? (ocrPageMap.get(p.pageNumber) ?? '') : p.text,
        }));
        const mergedFullText = mergedPages.map((p) => p.text).join('\n\n');
        pages = mergedPages;
        keyValuePairs =
          Object.keys(ocrResult.keyValuePairs).length > 0
            ? ocrResult.keyValuePairs
            : this.extractHeaderHints(mergedFullText);
        tabelaServicos =
          ocrResult.rawServiceRows?.length
            ? this.tableExtractor.extractBest(ocrResult)
            : this.tableExtractor.extract(mergedFullText);
        fullText = this.preProcess(mergedFullText);
      } else {
        fullText = this.preProcess(fullText);
        tabelaServicos = this.tableExtractor.extract(fullText);
        keyValuePairs = this.extractHeaderHints(fullText);
      }

      // Textract fallback: only when no services found by any previous method
      if (tabelaServicos.length === 0) {
        this.logger.log(`No services found via OCR — trying AWS Textract for ${atestadoId}`);
        try {
          const textractTables = await this.textract.analyzeTables(atestado.s3Key);
          if (textractTables.length > 0) {
            const items = this.tableExtractor.extractFromTables(textractTables);
            if (items.length > 0) {
              tabelaServicos = items;
              this.logger.log(`Textract found ${tabelaServicos.length} services for ${atestadoId}`);
            }
          }
        } catch (err) {
          this.logger.warn(`Textract fallback failed for ${atestadoId}`, err);
        }
      }

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

  /**
   * Runs the HEADER_PATTERNS against the first 3000 chars of the raw text
   * and returns matched key-value hints to pass to the extraction LLM.
   */
  private extractHeaderHints(text: string): Record<string, string> {
    const sample = text.slice(0, 3000);
    const hints: Record<string, string> = {};
    for (const [key, re] of HEADER_PATTERNS) {
      const m = re.exec(sample);
      if (m?.[1]) hints[key] = m[1].trim();
    }
    return hints;
  }
}
