import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { Embedding } from '../entity/embedding.entity';

export interface RetrievedChunk {
  chunkId: string;
  atestadoId: string;
  originalFilename: string;
  pageNumber: number;
  content: string;
  similarity: number;
}

@Injectable()
export class EmbeddingRepository extends DefaultTypeOrmRepository<Embedding> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Embedding, dataSource);
  }

  async saveMany(
    embeddings: Array<{ chunkId: string; vector: string; metadata?: Record<string, unknown> }>,
  ): Promise<Embedding[]> {
    const entities = embeddings.map((e) => super.create(e));
    return (await super.save(entities)) as Embedding[];
  }

  async vectorSearch(vectorLiteral: string, limit: number): Promise<RetrievedChunk[]> {
    return this.query<RetrievedChunk>(
      `
      SELECT
        c.id              AS "chunkId",
        c.atestado_id     AS "atestadoId",
        c.original_filename AS "originalFilename",
        c.page_number     AS "pageNumber",
        c.content,
        1 - (e.vector <=> $1::vector) AS similarity
      FROM embeddings e
      JOIN chunks c ON c.id = e.chunk_id
      ORDER BY e.vector <=> $1::vector
      LIMIT $2
      `,
      [vectorLiteral, limit],
    );
  }

  async keywordSearch(keywords: string[], limit: number): Promise<RetrievedChunk[]> {
    const conditions = keywords.map((_, i) => `c.content ILIKE $${i + 1}`).join(' OR ');
    const params: unknown[] = keywords.map((k) => `%${k}%`);
    params.push(String(limit));

    return this.query<RetrievedChunk>(
      `
      SELECT
        c.id              AS "chunkId",
        c.atestado_id     AS "atestadoId",
        c.original_filename AS "originalFilename",
        c.page_number     AS "pageNumber",
        c.content,
        0.5               AS similarity
      FROM chunks c
      WHERE ${conditions}
      LIMIT $${params.length}
      `,
      params,
    );
  }
}
