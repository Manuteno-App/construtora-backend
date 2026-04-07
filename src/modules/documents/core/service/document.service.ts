import { Injectable } from '@nestjs/common';
import { NotFoundDomainException } from '../../../../common/exception/not-found-domain.exception';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { Atestado, AtestadoStatus } from '../../persistence/entity/atestado.entity';
import { AtestadoRepository } from '../../persistence/repository/atestado.repository';

export interface ListAtestadosParams {
  status?: AtestadoStatus;
  page: number;
  limit: number;
}

@Injectable()
export class DocumentService {
  constructor(
    private readonly atestadoRepo: AtestadoRepository,
    private readonly storage: StorageService,
  ) {}

  async createAtestado(params: { s3Key: string; originalFilename: string }): Promise<Atestado> {
    return this.atestadoRepo.createAndSave(params);
  }

  async findById(id: string): Promise<Atestado> {
    const atestado = await this.atestadoRepo.findById(id);
    if (!atestado) throw new NotFoundDomainException('Atestado', id);
    return atestado;
  }

  async findByIdWithRelations(id: string): Promise<Atestado> {
    const atestado = await this.atestadoRepo.findByIdWithRelations(id);
    if (!atestado) throw new NotFoundDomainException('Atestado', id);
    return atestado;
  }

  async listAtestados(params: ListAtestadosParams): Promise<{ items: Atestado[]; total: number }> {
    const [items, total] = await this.atestadoRepo.findPaginated(
      params.status,
      params.page,
      params.limit,
    );
    return { items, total };
  }

  async updateStatus(
    id: string,
    status: AtestadoStatus,
    errorMessage?: string | null,
  ): Promise<void> {
    await this.atestadoRepo.updateStatus(id, status, errorMessage);
  }

  async getSignedDownloadUrl(id: string): Promise<string> {
    const atestado = await this.atestadoRepo.findById(id);
    if (!atestado) throw new NotFoundDomainException('Atestado', id);
    return this.storage.getSignedUrl(atestado.s3Key);
  }

  async delete(id: string): Promise<void> {
    const atestado = await this.atestadoRepo.findById(id);
    if (!atestado) throw new NotFoundDomainException('Atestado', id);
    await this.storage.delete(atestado.s3Key).catch(() => {
      /* file may not exist in S3 */
    });
    await this.atestadoRepo.deleteById(id);
  }
}
