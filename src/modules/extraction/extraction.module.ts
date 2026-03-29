import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Obra } from './persistence/entity/obra.entity';
import { Empresa } from './persistence/entity/empresa.entity';
import { Contrato } from './persistence/entity/contrato.entity';
import { ServicoExecutado } from './persistence/entity/servico-executado.entity';
import { ObraRepository } from './persistence/repository/obra.repository';
import { EmpresaRepository } from './persistence/repository/empresa.repository';
import { ContratoRepository } from './persistence/repository/contrato.repository';
import { ServicoExecutadoRepository } from './persistence/repository/servico-executado.repository';
import { EntityOrchestrationService } from './core/service/entity-orchestration.service';
import { ExtractionService } from './core/service/extraction.service';
import { ExtractionFacade } from './public-api/facade/extraction.facade';
import { EXTRACTION_API } from './public-api/interface/extraction-api.interface';
import { ExtractionProcessor } from './processor/extraction.processor';
import {
  ExtractionController,
  AtestadoServicosController,
} from './http/rest/controller/extraction.controller';
import { DocumentsModule } from '../documents/documents.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { EXTRACTION_QUEUE, INDEXING_QUEUE } from '../infrastructure/queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Obra, Empresa, Contrato, ServicoExecutado]),
    BullModule.registerQueue({ name: EXTRACTION_QUEUE }, { name: INDEXING_QUEUE }),
    DocumentsModule,
    IngestionModule,
  ],
  providers: [
    ObraRepository,
    EmpresaRepository,
    ContratoRepository,
    ServicoExecutadoRepository,
    EntityOrchestrationService,
    ExtractionService,
    ExtractionFacade,
    { provide: EXTRACTION_API, useExisting: ExtractionFacade },
    ExtractionProcessor,
  ],
  controllers: [ExtractionController, AtestadoServicosController],
  exports: [
    ExtractionFacade,
    { provide: EXTRACTION_API, useExisting: ExtractionFacade },
  ],
})
export class ExtractionModule {}
