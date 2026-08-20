import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { INDEXING_API, IIndexingApi } from '../../../indexing/public-api/interface/indexing-api.interface';

export interface SemanticServiceMatch {
  serviceId: string;
  descricao: string;
  similarity: number;
  unidadeSugerida?: string;
}

@Injectable()
export class ServiceSemanticIndexService {
  private readonly logger = new Logger(ServiceSemanticIndexService.name);
  private readonly threshold: number;
  private readonly limit: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(INDEXING_API) private readonly indexing: IIndexingApi,
    config: ConfigService,
  ) {
    this.threshold = config.get<number>('qualification.semanticSimilarityThreshold') ?? 0.78;
    this.limit = config.get<number>('qualification.semanticTopK') ?? 8;
  }

  async indexAtestadoServices(atestadoId: string): Promise<void> {
    const rows = await this.dataSource.query<{ id: string; descricao: string }[]>(
      `SELECT id, descricao FROM servicos_executados
       WHERE atestado_id = $1 AND descricao <> ''
       ORDER BY id`,
      [atestadoId],
    );
    await this.indexRows(rows);
  }

  async indexService(serviceId: string): Promise<void> {
    const [row] = await this.dataSource.query<{ id: string; descricao: string }[]>(
      'SELECT id, descricao FROM servicos_executados WHERE id = $1',
      [serviceId],
    );
    if (row) await this.indexRows([row]);
  }

  /** Operational entry point for a one-off deployment backfill. */
  async backfill(limit = 500): Promise<number> {
    const rows = await this.dataSource.query<{ id: string; descricao: string }[]>(
      `SELECT id, descricao FROM servicos_executados
       WHERE semantic_embedding IS NULL AND descricao <> ''
       ORDER BY id LIMIT $1`,
      [limit],
    );
    await this.indexRows(rows);
    return rows.length;
  }

  async search(query: string): Promise<SemanticServiceMatch[]> {
    if (!query.trim()) return [];
    try {
      const vector = this.indexing.toVectorLiteral(await this.indexing.embedText(query.trim()));
      const rows = await this.dataSource.query<SemanticServiceMatch[]>(
        `SELECT s.id AS "serviceId", s.descricao,
                (1 - (s.semantic_embedding <=> $1::vector))::float AS similarity,
                s.unidade AS "unidadeSugerida"
         FROM servicos_executados s
         WHERE s.semantic_embedding IS NOT NULL
           AND 1 - (s.semantic_embedding <=> $1::vector) >= $2
         ORDER BY s.semantic_embedding <=> $1::vector
         LIMIT $3`,
        [vector, this.threshold, this.limit],
      );
      return rows;
    } catch (error) {
      this.logger.warn(`Semantic service search unavailable: ${String(error)}`);
      return [];
    }
  }

  private async indexRows(rows: Array<{ id: string; descricao: string }>): Promise<void> {
    if (!rows.length) return;
    try {
      const embeddings = await this.indexing.embedTexts(rows.map((row) => row.descricao));
      await Promise.all(rows.map((row, index) => this.dataSource.query(
        'UPDATE servicos_executados SET semantic_embedding = $1::vector WHERE id = $2',
        [this.indexing.toVectorLiteral(embeddings[index]), row.id],
      )));
    } catch (error) {
      // Semantic discovery must never make document extraction or manual repair fail.
      this.logger.warn(`Could not index service descriptions: ${String(error)}`);
    }
  }
}
