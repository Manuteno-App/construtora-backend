import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Embedding } from './persistence/entity/embedding.entity';
import { EmbeddingRepository } from './persistence/repository/embedding.repository';
import { EmbeddingService } from './core/service/embedding.service';
import { IndexingService } from './core/service/indexing.service';
import { IndexingFacade } from './public-api/facade/indexing.facade';
import { INDEXING_API } from './public-api/interface/indexing-api.interface';
import { IndexingProcessor } from './processor/indexing.processor';
import { DocumentsModule } from '../documents/documents.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { INDEXING_QUEUE } from '../infrastructure/queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Embedding]),
    BullModule.registerQueue({ name: INDEXING_QUEUE }),
    DocumentsModule,
    IngestionModule,
  ],
  providers: [
    EmbeddingRepository,
    EmbeddingService,
    IndexingService,
    IndexingFacade,
    { provide: INDEXING_API, useExisting: IndexingFacade },
    IndexingProcessor,
  ],
  exports: [
    IndexingFacade,
    { provide: INDEXING_API, useExisting: IndexingFacade },
  ],
})
export class IndexingModule {}
