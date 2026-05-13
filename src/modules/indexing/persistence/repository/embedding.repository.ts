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

export interface SearchFilters {
  estado?: string;
  periodo?: { de: string; ate: string };
  obraId?: string;
  empresaId?: string;
}

/** Builds optional WHERE clauses and appends params, returning the SQL fragment. */
function buildFilterClauses(filters: SearchFilters | undefined, params: unknown[]): string {
  if (!filters) return '';
  const conditions: string[] = [];

  if (filters.estado) {
    params.push(`%${filters.estado}%`);
    conditions.push(`UPPER(o.local) ILIKE UPPER($${params.length})`);
  }
  if (filters.obraId) {
    params.push(filters.obraId);
    conditions.push(`o.id = $${params.length}`);
  }
  if (filters.empresaId) {
    params.push(filters.empresaId);
    conditions.push(`ct.empresa_id = $${params.length}`);
  }
  if (filters.periodo?.de) {
    params.push(filters.periodo.de);
    conditions.push(`a.created_at >= $${params.length}`);
  }
  if (filters.periodo?.ate) {
    params.push(filters.periodo.ate);
    conditions.push(`a.created_at <= $${params.length}`);
  }

  return conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
}

/**
 * Returns the JOIN clauses required by the active filters.
 * Always joins atestados for periodo filter; joins obras for estado/obraId;
 * joins contratos for empresaId (requires obras).
 */
function buildFilterJoins(filters: SearchFilters | undefined): string {
  if (!filters) return '';
  const needsAtestado = !!(filters.periodo?.de || filters.periodo?.ate);
  const needsObras = !!(filters.estado || filters.obraId || filters.empresaId);
  const needsContratos = !!filters.empresaId;

  const joins: string[] = [];
  if (needsAtestado) joins.push('JOIN atestados a ON a.id = c.atestado_id');
  if (needsObras) joins.push('LEFT JOIN obras o ON o.atestado_id = c.atestado_id');
  if (needsContratos) joins.push('LEFT JOIN contratos ct ON ct.obra_id = o.id');
  return joins.length > 0 ? '\n      ' + joins.join('\n      ') : '';
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

  async vectorSearch(vectorLiteral: string, limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]> {
    const params: unknown[] = [vectorLiteral, limit];
    const filterJoins = buildFilterJoins(filters);
    const filterWhere = buildFilterClauses(filters, params);

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
      JOIN chunks c ON c.id = e.chunk_id${filterJoins}
      WHERE TRUE${filterWhere}
      ORDER BY e.vector <=> $1::vector
      LIMIT $2
      `,
      params,
    );
  }

  async keywordSearch(keywords: string[], limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]> {
    if (keywords.length === 0) return [];

    const params: unknown[] = keywords.map((k) => `%${k}%`);
    const orContent = keywords.map((_, i) => `c.content ILIKE $${i + 1}`).join(' OR ');
    const orFilename = keywords.map((_, i) => `c.original_filename ILIKE $${i + 1}`).join(' OR ');
    // Score = number of keywords that appear in content (used for ORDER BY)
    const scoreExpr = keywords
      .map((_, i) => `(CASE WHEN c.content ILIKE $${i + 1} THEN 1 ELSE 0 END)`)
      .join(' + ');

    const filterJoins = buildFilterJoins(filters);
    const filterWhere = buildFilterClauses(filters, params);
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
      FROM chunks c${filterJoins}
      WHERE ((${orContent}) OR (${orFilename}))${filterWhere}
      ORDER BY (${scoreExpr}) DESC
      LIMIT $${params.length}
      `,
      params,
    );
  }

  /**
   * Strict AND search: all keywords must appear in the same chunk.
   * Returns similarity=0.9 so results always pass the threshold and rank first.
   */
  async strictKeywordSearch(keywords: string[], limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]> {
    if (keywords.length === 0) return [];

    const params: unknown[] = keywords.map((k) => `%${k}%`);
    const andConditions = keywords.map((_, i) => `c.content ILIKE $${i + 1}`).join(' AND ');

    const filterJoins = buildFilterJoins(filters);
    const filterWhere = buildFilterClauses(filters, params);
    params.push(String(limit));

    return this.query<RetrievedChunk>(
      `
      SELECT
        c.id              AS "chunkId",
        c.atestado_id     AS "atestadoId",
        c.original_filename AS "originalFilename",
        c.page_number     AS "pageNumber",
        c.content,
        0.9               AS similarity
      FROM chunks c${filterJoins}
      WHERE ${andConditions}${filterWhere}
      LIMIT $${params.length}
      `,
      params,
    );
  }

  /**
   * Full-text search using PostgreSQL tsvector/tsquery with Portuguese dictionary.
   * Requires the content_tsv column added by migration 1747000000000.
   * Returns similarity=0.6 (between keyword=0.5 and strict=0.9).
   */
  async fullTextSearch(query: string, limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]> {
    const params: unknown[] = [query, limit];
    const filterJoins = buildFilterJoins(filters);
    const filterWhere = buildFilterClauses(filters, params);

    return this.query<RetrievedChunk>(
      `
      SELECT
        c.id              AS "chunkId",
        c.atestado_id     AS "atestadoId",
        c.original_filename AS "originalFilename",
        c.page_number     AS "pageNumber",
        c.content,
        0.6               AS similarity
      FROM chunks c${filterJoins}
      WHERE c.content_tsv @@ plainto_tsquery('portuguese', $1)${filterWhere}
      ORDER BY ts_rank(c.content_tsv, plainto_tsquery('portuguese', $1)) DESC
      LIMIT $2
      `,
      params,
    );
  }
}
