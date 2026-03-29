import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Chunk } from './persistence/entity/chunk.entity';
import { ChunkRepository } from './persistence/repository/chunk.repository';
import { IngestionService } from './core/service/ingestion.service';
import { OcrService } from './core/service/ocr.service';
import { TableExtractorService } from './core/service/table-extractor.service';
import { VisionService } from './core/service/vision.service';
import { IngestionFacade } from './public-api/facade/ingestion.facade';
import { INGESTION_API } from './public-api/interface/ingestion-api.interface';
import { IngestionProcessor } from './processor/ingestion.processor';
import { IngestionController } from './http/rest/controller/ingestion.controller';
import { DocumentsModule } from '../documents/documents.module';
import { StorageModule } from '../infrastructure/storage/storage.module';
import { INGESTION_QUEUE, EXTRACTION_QUEUE } from '../infrastructure/queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chunk]),
    BullModule.registerQueue({ name: INGESTION_QUEUE }, { name: EXTRACTION_QUEUE }),
    StorageModule,
    DocumentsModule,
  ],
  providers: [
    ChunkRepository,
    OcrService,
    TableExtractorService,
    VisionService,
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
