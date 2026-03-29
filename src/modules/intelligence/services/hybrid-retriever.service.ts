import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmbeddingService } from '../../indexing/services/embedding.service';
import { Chunk } from '../../database/entities/chunk.entity';
import { Embedding } from '../../database/entities/embedding.entity';

export interface RetrievedChunk {
  chunkId: string;
  atestadoId: string;
  originalFilename: string;
  pageNumber: number;
  content: string;
  similarity: number;
}

export interface RetrievalFilters {
  estado?: string;
  periodo?: { de: string; ate: string };
  obraId?: string;
  empresaId?: string;
}

@Injectable()
export class HybridRetrieverService {
  private readonly logger = new Logger(HybridRetrieverService.name);
  private readonly topK: number;

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly config: ConfigService,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    @InjectRepository(Embedding)
    private readonly embeddingRepo: Repository<Embedding>,
  ) {
    this.topK = config.get<number>('rag.topK') ?? 10;
  }

  async retrieve(query: string, filters?: RetrievalFilters): Promise<RetrievedChunk[]> {
    const keywords = this.extractKeywords(query);

    // Run vector search and keyword search in parallel
    const [vectorRows, keywordRows] = await Promise.all([
      this.vectorSearch(query, this.topK),
      keywords.length > 0 ? this.keywordSearch(keywords, this.topK) : Promise.resolve([]),
    ]);

    // Merge: keyword hits get similarity = 1.0 to guarantee they pass the threshold
    const merged = new Map<string, RetrievedChunk>();

    for (const row of vectorRows) {
      merged.set(row.chunkId, row);
    }

    for (const row of keywordRows) {
      const existing = merged.get(row.chunkId);
      if (!existing) {
        // Keyword-only hit: assign high synthetic similarity so it passes threshold
        merged.set(row.chunkId, { ...row, similarity: 1.0 });
      } else {
        // Boost similarity for chunks that match both signals
        merged.set(row.chunkId, { ...existing, similarity: Math.min(1, existing.similarity + 0.2) });
      }
    }

    const result = Array.from(merged.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.topK);

    if (result.length > 0) {
      const scores = result.map((r) => Number(r.similarity).toFixed(3)).join(', ');
      this.logger.log(
        `Hybrid retrieve: ${vectorRows.length} vector + ${keywordRows.length} keyword hits → ${result.length} final. Similarities: [${scores}]`,
      );
    } else {
      this.logger.warn('No chunks found — embeddings table may be empty');
    }

    return result;
  }

  private async vectorSearch(query: string, limit: number): Promise<RetrievedChunk[]> {
    const queryVector = await this.embeddingService.embedSingle(query);
    const vectorLiteral = EmbeddingService.toVectorLiteral(queryVector);

    return this.embeddingRepo.query(
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
    ) as Promise<RetrievedChunk[]>;
  }

  private async keywordSearch(keywords: string[], limit: number): Promise<RetrievedChunk[]> {
    // Build a tsquery from keywords: each keyword becomes a simple ILIKE pattern so it
    // works regardless of whether unaccent/pg_trgm extensions are installed.
    const conditions = keywords.map((_, i) => `c.content ILIKE $${i + 1}`).join(' OR ');
    const params = keywords.map((k) => `%${k}%`);
    params.push(String(limit));

    return this.chunkRepo.query(
      `
      SELECT
        c.id              AS "chunkId",
        c.atestado_id     AS "atestadoId",
        c.original_filename AS "originalFilename",
        c.page_number     AS "pageNumber",
        c.content,
        0.0               AS similarity
      FROM chunks c
      WHERE ${conditions}
      LIMIT $${params.length}
      `,
      params,
    ) as Promise<RetrievedChunk[]>;
  }

  /**
   * Strip Portuguese stop-words and short filler to extract searchable keywords.
   * e.g. "o que tem de TERRAPLENAGEM" → ["TERRAPLENAGEM"]
   */
  private extractKeywords(query: string): string[] {
    const STOP_WORDS = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
      'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
      'por', 'para', 'com', 'sem', 'sob', 'sobre', 'entre', 'até', 'ate',
      'que', 'qual', 'quais', 'como', 'quando', 'onde', 'quem',
      'tem', 'há', 'ha', 'ter', 'ser', 'é', 'e', 'são', 'sao',
      'me', 'te', 'se', 'nos', 'vos', 'lhe', 'lhes',
      'este', 'essa', 'isso', 'aqui', 'ali', 'mais', 'muito',
      'favor', 'liste', 'listar', 'mostre', 'mostrar', 'diga', 'dizer',
      'existe', 'existem', 'encontrou', 'encontrar', 'falar', 'fale',
    ]);

    return query
      .split(/\s+/)
      .map((w) => w.replace(/[.,;:?!()[\]"']/g, '').trim())
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
  }
}
