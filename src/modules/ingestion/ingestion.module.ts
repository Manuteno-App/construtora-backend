import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Atestado } from '../database/entities/atestado.entity';
import { Chunk } from '../database/entities/chunk.entity';
import { Embedding } from '../database/entities/embedding.entity';
import { IngestionController } from './ingestion.controller';
import { IngestionProcessor } from './processors/ingestion.processor';
import { OcrService } from './services/ocr.service';
import { TableExtractorService } from './services/table-extractor.service';
import { VisionService } from './services/vision.service';
import { StorageModule } from '../storage/storage.module';
import { EXTRACTION_QUEUE, INGESTION_QUEUE } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Atestado, Chunk, Embedding]),
    BullModule.registerQueue({ name: INGESTION_QUEUE }, { name: EXTRACTION_QUEUE }),
    StorageModule,
  ],
  controllers: [IngestionController],
  providers: [IngestionProcessor, OcrService, TableExtractorService, VisionService],
  exports: [OcrService, TableExtractorService, VisionService],
})
export class IngestionModule {}
