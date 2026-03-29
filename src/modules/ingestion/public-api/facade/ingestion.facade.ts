import { Injectable } from '@nestjs/common';
import { ChunkRepository } from '../../persistence/repository/chunk.repository';
import { IIngestionApi } from '../interface/ingestion-api.interface';
import { Chunk } from '../../persistence/entity/chunk.entity';

@Injectable()
export class IngestionFacade implements IIngestionApi {
  constructor(private readonly chunkRepo: ChunkRepository) {}

  async getChunksByAtestadoId(atestadoId: string): Promise<Chunk[]> {
    return this.chunkRepo.findByAtestadoId(atestadoId);
  }

  async getChunksByIds(ids: string[]): Promise<Chunk[]> {
    return this.chunkRepo.findByIds(ids);
  }

  async getUnembeddedChunksByAtestadoId(atestadoId: string): Promise<Chunk[]> {
    return this.chunkRepo.findUnembeddedByAtestadoId(atestadoId);
  }
}
