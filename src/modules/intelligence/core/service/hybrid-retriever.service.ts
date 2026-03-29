import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IIndexingApi, INDEXING_API } from '../../../indexing/public-api/interface/indexing-api.interface';
import type { RetrievedChunk } from '../../../indexing/persistence/repository/embedding.repository';

export { RetrievedChunk };

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
    @Inject(INDEXING_API) private readonly indexingApi: IIndexingApi,
    private readonly config: ConfigService,
  ) {
    this.topK = config.get<number>('rag.topK') ?? 10;
  }

  async retrieve(query: string, _filters?: RetrievalFilters): Promise<RetrievedChunk[]> {
    const keywords = this.extractKeywords(query);
    this.logger.log(`Extracted keywords: [${keywords.join(', ')}]`);

    const queryVector = await this.indexingApi.embedText(query);
    const vectorLiteral = this.indexingApi.toVectorLiteral(queryVector);

    const [vectorRows, keywordRows] = await Promise.all([
      this.indexingApi.searchSimilar(vectorLiteral, this.topK),
      keywords.length > 0
        ? this.indexingApi.keywordSearch(keywords, this.topK)
        : Promise.resolve<RetrievedChunk[]>([]),
    ]);

    const merged = new Map<string, RetrievedChunk>();

    for (const row of vectorRows) {
      merged.set(row.chunkId, row);
    }

    for (const row of keywordRows) {
      const existing = merged.get(row.chunkId);
      if (!existing) {
        merged.set(row.chunkId, { ...row, similarity: 1.0 });
      } else {
        merged.set(row.chunkId, {
          ...existing,
          similarity: Math.min(1, existing.similarity + 0.2),
        });
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
      this.logger.warn(
        `No chunks found — vectorRows=${vectorRows.length}, keywordRows=${keywordRows.length}. Keywords used: [${keywords.join(', ')}]. Embeddings table may be empty or document not indexed.`,
      );
    }

    return result;
  }

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
