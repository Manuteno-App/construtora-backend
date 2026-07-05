import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { configuration, configurationSchema } from './config/configuration';
import { HealthController } from './health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ExtractionModule } from './modules/extraction/extraction.module';
import { IndexingModule } from './modules/indexing/indexing.module';
import { DatabaseModule } from './modules/infrastructure/database/database.module';
import { QueueModule } from './modules/infrastructure/queue/queue.module';
import { StorageModule } from './modules/infrastructure/storage/storage.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { McpModule } from './modules/mcp/mcp.module';
import { MeasurementsModule } from './modules/measurements/measurements.module';
import { QualificationModule } from './modules/qualification/qualification.module';

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
    AuthModule,
    MeasurementsModule,
    QualificationModule,
    McpModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
