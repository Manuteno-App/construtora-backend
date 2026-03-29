import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { configuration, configurationSchema } from './config/configuration';
import { DatabaseModule } from './modules/database/database.module';
import { QueueModule } from './modules/queue/queue.module';
import { StorageModule } from './modules/storage/storage.module';
import { AtestadosModule } from './modules/atestados/atestados.module';
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
    AtestadosModule,
    IngestionModule,
    ExtractionModule,
    IndexingModule,
    IntelligenceModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
