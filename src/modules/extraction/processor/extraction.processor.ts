import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ExtractionService } from '../core/service/extraction.service';
import { IDocumentsApi, DOCUMENTS_API } from '../../documents/public-api/interface/documents-api.interface';
import { AtestadoStatus } from '../../documents/persistence/entity/atestado.entity';
import { EXTRACTION_QUEUE, INDEXING_QUEUE } from '../../infrastructure/queue/queue.module';
import type { ServicoItem } from '../../ingestion/core/service/table-extractor.service';

export interface ExtractionJobPayload {
  atestadoId: string;
  chunkIds: string[];
  tabelaServicos: ServicoItem[];
  keyValuePairs?: Record<string, string>;
}

@Processor(EXTRACTION_QUEUE)
export class ExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExtractionProcessor.name);

  constructor(
    private readonly extractionService: ExtractionService,
    @Inject(DOCUMENTS_API) private readonly documentsApi: IDocumentsApi,
    @InjectQueue(INDEXING_QUEUE) private readonly indexingQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ExtractionJobPayload>): Promise<void> {
    const { atestadoId, chunkIds, tabelaServicos, keyValuePairs = {} } = job.data;
    this.logger.log(`Processing extraction for atestado ${atestadoId}`);

    try {
      await this.extractionService.extractAndPersist({
        atestadoId,
        chunkIds,
        tabelaServicos,
        keyValuePairs,
      });

      await this.indexingQueue.add('index-embeddings', { atestadoId, chunkIds });
      this.logger.log(`Extraction done for ${atestadoId}`);
    } catch (err) {
      this.logger.error(`Extraction failed for ${atestadoId}`, err);
      await this.documentsApi.updateAtestadoStatus(atestadoId, AtestadoStatus.ERROR, String(err));
      throw err;
    }
  }
}
