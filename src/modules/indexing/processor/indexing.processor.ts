import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { IndexingService } from '../core/service/indexing.service';
import { INDEXING_QUEUE } from '../../infrastructure/queue/queue.module';

export interface IndexingJobPayload {
  atestadoId: string;
  chunkIds: string[];
}

@Processor(INDEXING_QUEUE)
export class IndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexingProcessor.name);

  constructor(private readonly indexingService: IndexingService) {
    super();
  }

  async process(job: Job<IndexingJobPayload>): Promise<void> {
    const { atestadoId } = job.data;
    this.logger.log(`Processing indexing for atestado ${atestadoId}`);
    await this.indexingService.indexAtestado(atestadoId);
  }
}
