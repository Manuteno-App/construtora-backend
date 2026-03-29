import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { NotFoundDomainException } from '../../../../common/exception/not-found-domain.exception';
import { StorageService } from '../../../infrastructure/storage/storage.service';
import { INGESTION_QUEUE } from '../../../infrastructure/queue/queue.module';
import { DocumentService } from '../../../documents/core/service/document.service';
import { AtestadoStatus } from '../../../documents/persistence/entity/atestado.entity';
import { ChunkRepository } from '../../persistence/repository/chunk.repository';

@Injectable()
export class IngestionService {
  constructor(
    private readonly storage: StorageService,
    private readonly documentService: DocumentService,
    private readonly chunkRepo: ChunkRepository,
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue,
  ) {}

  async uploadAndEnqueue(
    file: Express.Multer.File,
  ): Promise<{ atestadoId: string; status: AtestadoStatus }> {
    const s3Key = `atestados/${uuidv4()}/${file.originalname}`;
    await this.storage.upload(file.buffer, s3Key, 'application/pdf');

    const atestado = await this.documentService.createAtestado({
      s3Key,
      originalFilename: file.originalname,
    });

    await this.ingestionQueue.add('process-pdf', { atestadoId: atestado.id });

    return { atestadoId: atestado.id, status: atestado.status };
  }

  async reindex(id: string): Promise<{ atestadoId: string; originalFilename: string; status: AtestadoStatus }> {
    const atestado = await this.documentService.findById(id);

    await this.chunkRepo.deleteByAtestadoId(id);
    await this.documentService.updateStatus(id, AtestadoStatus.PENDING, null);
    await this.ingestionQueue.add('process-pdf', { atestadoId: id });

    return {
      atestadoId: id,
      originalFilename: atestado.originalFilename,
      status: AtestadoStatus.PENDING,
    };
  }

  async getStatus(
    id: string,
  ): Promise<{ atestadoId: string; status: AtestadoStatus; originalFilename: string; createdAt: Date; errorMessage?: string }> {
    const atestado = await this.documentService.findById(id);
    return {
      atestadoId: atestado.id,
      status: atestado.status,
      originalFilename: atestado.originalFilename,
      createdAt: atestado.createdAt,
      errorMessage: atestado.errorMessage,
    };
  }
}
