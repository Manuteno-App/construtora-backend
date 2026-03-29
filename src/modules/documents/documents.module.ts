import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Atestado } from './persistence/entity/atestado.entity';
import { AtestadoRepository } from './persistence/repository/atestado.repository';
import { DocumentService } from './core/service/document.service';
import { DocumentsFacade } from './public-api/facade/documents.facade';
import { DOCUMENTS_API } from './public-api/interface/documents-api.interface';
import { AtestadosController } from './http/rest/controller/atestados.controller';
import { StorageModule } from '../infrastructure/storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([Atestado]), StorageModule],
  providers: [
    AtestadoRepository,
    DocumentService,
    DocumentsFacade,
    { provide: DOCUMENTS_API, useExisting: DocumentsFacade },
  ],
  controllers: [AtestadosController],
  exports: [
    DocumentService,
    DocumentsFacade,
    { provide: DOCUMENTS_API, useExisting: DocumentsFacade },
  ],
})
export class DocumentsModule {}
