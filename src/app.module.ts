import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { configuration, configurationSchema } from './config/configuration';
import { DatabaseModule } from './modules/infrastructure/database/database.module';
import { QueueModule } from './modules/infrastructure/queue/queue.module';
import { StorageModule } from './modules/infrastructure/storage/storage.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { ExtractionModule } from './modules/extraction/extraction.module';
import { IndexingModule } from './modules/indexing/indexing.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: configurationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    DatabaseModule,
    QueueModule,
    StorageModule,
    TerminusModule,
    DocumentsModule,
    IngestionModule,
    ExtractionModule,
    IndexingModule,
    IntelligenceModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
