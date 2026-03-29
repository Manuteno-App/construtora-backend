import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { Chunk } from '../entity/chunk.entity';

export interface CreateChunkData {
  atestadoId: string;
  originalFilename: string;
  content: string;
  chunkIndex: number;
  pageNumber?: number;
}

@Injectable()
export class ChunkRepository extends DefaultTypeOrmRepository<Chunk> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Chunk, dataSource);
  }

  async saveMany(chunks: CreateChunkData[]): Promise<Chunk[]> {
    const entities = chunks.map((c) => super.create(c));
    return (await super.save(entities)) as Chunk[];
  }

  async findByIds(ids: string[]): Promise<Chunk[]> {
    return this.find({ where: { id: In(ids) } });
  }

  async findByAtestadoId(atestadoId: string): Promise<Chunk[]> {
    return this.find({ where: { atestadoId } });
  }

  async findUnembeddedByAtestadoId(atestadoId: string): Promise<Chunk[]> {
    return this.createQueryBuilder('c')
      .leftJoin('c.embedding', 'e')
      .where('c.atestadoId = :atestadoId', { atestadoId })
      .andWhere('e.id IS NULL')
      .getMany();
  }

  async deleteByAtestadoId(atestadoId: string): Promise<void> {
    await this.delete({ atestadoId });
  }
}
