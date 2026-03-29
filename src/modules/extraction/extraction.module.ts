import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Atestado } from '../database/entities/atestado.entity';
import { Obra } from '../database/entities/obra.entity';
import { Empresa } from '../database/entities/empresa.entity';
import { Contrato } from '../database/entities/contrato.entity';
import { ServicoExecutado } from '../database/entities/servico-executado.entity';
import { Chunk } from '../database/entities/chunk.entity';
import { ExtractionProcessor } from './processors/extraction.processor';
import { ExtractionController } from './extraction.controller';
import { EXTRACTION_QUEUE, INDEXING_QUEUE } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Atestado, Obra, Empresa, Contrato, ServicoExecutado, Chunk]),
    BullModule.registerQueue({ name: EXTRACTION_QUEUE }, { name: INDEXING_QUEUE }),
  ],
  controllers: [ExtractionController],
  providers: [ExtractionProcessor],
})
export class ExtractionModule {}
