import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { INDEXING_QUEUE } from '../../infrastructure/queue/queue.module';
import { IndexingService } from '../core/service/indexing.service';

export interface IndexingJobPayload {
  atestadoId: string;
  chunkIds: string[];
}

@Processor(INDEXING_QUEUE, { lockDuration: 600_000 }) // 10-minute lock for embedding indexing
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
