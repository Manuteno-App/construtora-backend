import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import { Atestado, AtestadoStatus } from '../../database/entities/atestado.entity';
import { Chunk } from '../../database/entities/chunk.entity';
import { Embedding } from '../../database/entities/embedding.entity';
import { EmbeddingService } from '../services/embedding.service';
import { INDEXING_QUEUE } from '../../queue/queue.module';

export interface IndexingJobPayload {
  atestadoId: string;
  chunkIds: string[];
}

@Processor(INDEXING_QUEUE)
export class IndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexingProcessor.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    @InjectRepository(Atestado)
    private readonly atestadoRepo: Repository<Atestado>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    @InjectRepository(Embedding)
    private readonly embeddingRepo: Repository<Embedding>,
  ) {
    super();
  }

  async process(job: Job<IndexingJobPayload>): Promise<void> {
    const { atestadoId } = job.data;
    this.logger.log(`Processing indexing for atestado ${atestadoId}`);

    try {
      const chunks = await this.chunkRepo
        .createQueryBuilder('c')
        .leftJoin('c.embedding', 'e')
        .where('c.atestadoId = :atestadoId', { atestadoId })
        .andWhere('e.id IS NULL') // skip already embedded
        .getMany();

      if (chunks.length === 0) {
        this.logger.log(`No unembedded chunks for ${atestadoId}`);
      } else {
        const texts = chunks.map((c) => c.content);
        const embeddings = await this.embeddingService.embedTexts(texts);

        const embeddingEntities = chunks.map((chunk, i) => {
          const vectorLiteral = EmbeddingService.toVectorLiteral(embeddings[i]);
          return this.embeddingRepo.create({
            chunkId: chunk.id,
            vector: vectorLiteral,
            metadata: {
              atestadoId: chunk.atestadoId,
              chunkIndex: chunk.chunkIndex,
              pageNumber: chunk.pageNumber,
              originalFilename: chunk.originalFilename,
            },
          });
        });

        await this.embeddingRepo.save(embeddingEntities);
        this.logger.log(`Saved ${embeddingEntities.length} embeddings for ${atestadoId}`);
      }

      await this.atestadoRepo.update(atestadoId, { status: AtestadoStatus.DONE });
      this.logger.log(`Indexing DONE for ${atestadoId}`);
    } catch (err) {
      this.logger.error(`Indexing failed for ${atestadoId}`, err);
      await this.atestadoRepo.update(atestadoId, {
        status: AtestadoStatus.ERROR,
        errorMessage: String(err),
      });
      throw err;
    }
  }
}
