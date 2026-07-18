import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { DocumentService } from '../../../documents/core/service/document.service';
import { AtestadoStatus } from '../../../documents/persistence/entity/atestado.entity';
import { INGESTION_QUEUE } from '../../../infrastructure/queue/queue.module';
import { StorageService } from '../../../infrastructure/storage/storage.service';

@Injectable()
export class IngestionService {
  constructor(
    private readonly storage: StorageService,
    private readonly documentService: DocumentService,
    @InjectDataSource() private readonly dataSource: DataSource,
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

  async uploadManyAndEnqueue(
    files: Express.Multer.File[],
  ): Promise<{ results: Array<{ atestadoId: string; status: AtestadoStatus; originalFilename: string }> }> {
    const results = await Promise.all(files.map((file) => this.uploadAndEnqueue(file)));
    return {
      results: results.map((r, i) => ({
        ...r,
        originalFilename: files[i].originalname,
      })),
    };
  }

  async reindex(id: string): Promise<{ atestadoId: string; originalFilename: string; status: AtestadoStatus }> {
    const atestado = await this.documentService.findById(id);

    // Reprocessing replaces every derived record for this document.
    await this.clearAtestadoExtractionData(id);
    await this.documentService.updateStatus(id, AtestadoStatus.PENDING, null);
    await this.documentService.updateLastReprocessedAt(id);
    await this.ingestionQueue.add('process-pdf', { atestadoId: id });

    return {
      atestadoId: id,
      originalFilename: atestado.originalFilename,
      status: AtestadoStatus.PENDING,
    };
  }

  /** Reprocessing replaces document-derived data; shared companies remain intact. */
  private async clearAtestadoExtractionData(atestadoId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('DELETE FROM service_unit_observations WHERE atestado_id = $1', [atestadoId]);
      await manager.query('DELETE FROM servicos_executados WHERE atestado_id = $1', [atestadoId]);
      await manager.query('DELETE FROM chunks WHERE atestado_id = $1', [atestadoId]);
      // contratos are removed by the obra foreign-key cascade; companies are shared.
      await manager.query('DELETE FROM obras WHERE atestado_id = $1', [atestadoId]);
    });
  }

  async getStatus(
    id: string,
  ): Promise<{ atestadoId: string; status: AtestadoStatus; originalFilename: string; createdAt: Date; errorMessage?: string | null }> {
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
