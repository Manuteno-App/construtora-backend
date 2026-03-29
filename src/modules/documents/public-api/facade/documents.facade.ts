import { Injectable } from '@nestjs/common';
import { DocumentService } from '../../core/service/document.service';
import { IDocumentsApi, AtestadoRef } from '../interface/documents-api.interface';
import { AtestadoStatus } from '../../persistence/entity/atestado.entity';

@Injectable()
export class DocumentsFacade implements IDocumentsApi {
  constructor(private readonly documentService: DocumentService) {}

  async createAtestado(params: { s3Key: string; originalFilename: string }): Promise<AtestadoRef> {
    return this.documentService.createAtestado(params);
  }

  async findAtestadoById(id: string): Promise<AtestadoRef | null> {
    return this.documentService.findById(id).catch(() => null);
  }

  async updateAtestadoStatus(
    id: string,
    status: AtestadoStatus,
    errorMessage?: string | null,
  ): Promise<void> {
    return this.documentService.updateStatus(id, status, errorMessage);
  }

  async deleteAtestado(id: string): Promise<void> {
    return this.documentService.delete(id);
  }
}
