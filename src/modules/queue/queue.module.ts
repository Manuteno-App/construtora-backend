import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const INGESTION_QUEUE = 'ingestion-queue';
export const EXTRACTION_QUEUE = 'extraction-queue';
export const INDEXING_QUEUE = 'indexing-queue';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('redisUrl') ?? 'redis://localhost:6379';
        const url = new URL(redisUrl);
        return {
          connection: {
            host: url.hostname,
            port: parseInt(url.port || '6379', 10),
            password: url.password || undefined,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: INGESTION_QUEUE },
      { name: EXTRACTION_QUEUE },
      { name: INDEXING_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
