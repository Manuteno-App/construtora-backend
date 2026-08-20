import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundDomainException } from '../../../../common/exception/not-found-domain.exception';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { Chunk } from '../../../ingestion/persistence/entity/chunk.entity';
import { Atestado, AtestadoCategoria, AtestadoStatus } from '../../persistence/entity/atestado.entity';
import { AtestadoRepository } from '../../persistence/repository/atestado.repository';

export const categoryFromFilename = (filename: string): AtestadoCategoria | undefined => {
  const code = filename.trim().match(/^(ST|EST|CIV|SAN|INS)(?:\s*-|\s+|_|\.|$)/i)?.[1]?.toUpperCase();
  if (code === 'ST') return AtestadoCategoria.EST;
  return code && code in AtestadoCategoria ? code as AtestadoCategoria : undefined;
};

export interface ListAtestadosParams {
  status?: AtestadoStatus;
  page: number;
  limit: number;
  sortBy?: 'createdAt' | 'lastReprocessedAt';
  search?: string;
}

@Injectable()
export class DocumentService {
  constructor(
    private readonly atestadoRepo: AtestadoRepository,
    private readonly storage: StorageService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async createAtestado(params: { s3Key: string; originalFilename: string }): Promise<Atestado> {
    return this.atestadoRepo.createAndSave({
      ...params,
      categoria: categoryFromFilename(params.originalFilename),
    });
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
      params.sortBy,
      params.search,
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

  async updateLastReprocessedAt(id: string): Promise<void> {
    await this.atestadoRepo.updateLastReprocessedAt(id);
  }

  async rename(id: string, originalFilename: string): Promise<Atestado> {
    const baseName = originalFilename.trim().replace(/\.pdf$/i, '').trim();
    if (!baseName) {
      throw new BadRequestException('Informe um nome de arquivo válido');
    }

    const normalizedFilename = `${baseName}.pdf`;
    if (normalizedFilename.length > 255) {
      throw new BadRequestException('O nome do arquivo deve ter no máximo 255 caracteres');
    }

    return this.dataSource.transaction(async (manager) => {
      const atestado = await manager.findOne(Atestado, { where: { id } });
      if (!atestado) throw new NotFoundDomainException('Atestado', id);

      const categoria = categoryFromFilename(normalizedFilename) ?? null;
      await manager.update(Atestado, { id }, { originalFilename: normalizedFilename, categoria });
      await manager.update(Chunk, { atestadoId: id }, { originalFilename: normalizedFilename });

      return { ...atestado, originalFilename: normalizedFilename, categoria };
    });
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
