import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsModule } from '../documents/documents.module';
import { EXTRACTION_QUEUE, INGESTION_QUEUE } from '../infrastructure/queue/queue.module';
import { StorageModule } from '../infrastructure/storage/storage.module';
import { IngestionService } from './core/service/ingestion.service';
import { TableExtractorService } from './core/service/table-extractor.service';
import { TextractService, VisionService } from './core/service/vision.service';
import { IngestionController } from './http/rest/controller/ingestion.controller';
import { Chunk } from './persistence/entity/chunk.entity';
import { ChunkRepository } from './persistence/repository/chunk.repository';
import { IngestionProcessor } from './processor/ingestion.processor';
import { IngestionFacade } from './public-api/facade/ingestion.facade';
import { INGESTION_API } from './public-api/interface/ingestion-api.interface';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chunk]),
    BullModule.registerQueue({ name: INGESTION_QUEUE }, { name: EXTRACTION_QUEUE }),
    StorageModule,
    DocumentsModule,
  ],
  providers: [
    ChunkRepository,
    TableExtractorService,
    VisionService,
    TextractService,
    IngestionService,
    IngestionFacade,
    { provide: INGESTION_API, useExisting: IngestionFacade },
    IngestionProcessor,
  ],
  controllers: [IngestionController],
  exports: [
    IngestionFacade,
    { provide: INGESTION_API, useExisting: IngestionFacade },
  ],
})
export class IngestionModule {}
