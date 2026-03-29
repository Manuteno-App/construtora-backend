import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Atestado } from '../database/entities/atestado.entity';
import { Chunk } from '../database/entities/chunk.entity';
import { Embedding } from '../database/entities/embedding.entity';
import { IndexingProcessor } from './processors/indexing.processor';
import { EmbeddingService } from './services/embedding.service';
import { INDEXING_QUEUE } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Atestado, Chunk, Embedding]),
    BullModule.registerQueue({ name: INDEXING_QUEUE }),
  ],
  providers: [IndexingProcessor, EmbeddingService],
  exports: [EmbeddingService],
})
export class IndexingModule {}
