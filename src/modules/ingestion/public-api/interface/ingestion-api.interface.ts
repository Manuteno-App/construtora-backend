import { Chunk } from '../../persistence/entity/chunk.entity';

export interface IIngestionApi {
  getChunksByAtestadoId(atestadoId: string): Promise<Chunk[]>;
  getChunksByIds(ids: string[]): Promise<Chunk[]>;
  getUnembeddedChunksByAtestadoId(atestadoId: string): Promise<Chunk[]>;
}

export const INGESTION_API = Symbol('IIngestionApi');
