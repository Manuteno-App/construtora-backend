import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RetrievedChunk, SearchFilters } from '../../../indexing/persistence/repository/embedding.repository';
import { IIndexingApi, INDEXING_API } from '../../../indexing/public-api/interface/indexing-api.interface';

export { RetrievedChunk };

// Re-export SearchFilters as RetrievalFilters for backward compatibility
export type RetrievalFilters = SearchFilters;

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

  async retrieve(query: string, filters?: RetrievalFilters, intent?: 'QUANTITATIVO' | 'LISTAGEM' | 'NARRATIVO'): Promise<RetrievedChunk[]> {
    const effectiveTopK = intent === 'LISTAGEM' ? Math.max(this.topK, 30) : this.topK;

    const keywords = this.extractKeywords(query);
    const specificKeywords = this.extractSpecificKeywords(query);
    this.logger.log(`Keywords: [${keywords.join(', ')}]  Specific: [${specificKeywords.join(', ')}]  effectiveTopK: ${effectiveTopK}`);

    const queryVector = await this.indexingApi.embedText(query);
    const vectorLiteral = this.indexingApi.toVectorLiteral(queryVector);

    const [vectorRows, keywordRows, strictRows, fullTextRows] = await Promise.all([
      this.indexingApi.searchSimilar(vectorLiteral, effectiveTopK, filters),
      keywords.length > 0
        ? this.indexingApi.keywordSearch(keywords, effectiveTopK, filters)
        : Promise.resolve<RetrievedChunk[]>([]),
      specificKeywords.length >= 2
        ? this.indexingApi.strictKeywordSearch(specificKeywords, effectiveTopK, filters)
        : Promise.resolve<RetrievedChunk[]>([]),
      this.indexingApi.fullTextSearch(query, effectiveTopK, filters),
    ]);

    const merged = new Map<string, RetrievedChunk>();

    for (const row of vectorRows) {
      merged.set(row.chunkId, row);
    }

    for (const row of keywordRows) {
      const existing = merged.get(row.chunkId);
      if (!existing) {
        merged.set(row.chunkId, { ...row, similarity: row.similarity });
      } else {
        merged.set(row.chunkId, {
          ...existing,
          similarity: Math.min(1, existing.similarity + 0.2),
        });
      }
    }

    // Full-text search (tsvector): +0.1 boost over keyword-only
    for (const row of fullTextRows) {
      const existing = merged.get(row.chunkId);
      if (!existing) {
        merged.set(row.chunkId, { ...row, similarity: 0.6 });
      } else {
        merged.set(row.chunkId, {
          ...existing,
          similarity: Math.min(1, existing.similarity + 0.1),
        });
      }
    }

    // Strict AND matches get the highest boost — these are the most relevant
    for (const row of strictRows) {
      const existing = merged.get(row.chunkId);
      if (!existing) {
        merged.set(row.chunkId, { ...row, similarity: 0.9 });
      } else {
        merged.set(row.chunkId, {
          ...existing,
          similarity: Math.min(1, existing.similarity + 0.4),
        });
      }
    }

    const sorted = Array.from(merged.values()).sort((a, b) => b.similarity - a.similarity);

    // MMR: cap chunks per document to avoid context dominated by a single atestado.
    // Disabled for LISTAGEM so every document remains visible.
    const MAX_CHUNKS_PER_DOC = 3;
    let result: RetrievedChunk[];
    if (intent === 'LISTAGEM') {
      result = sorted.slice(0, effectiveTopK);
    } else {
      const docCount = new Map<string, number>();
      result = [];
      for (const chunk of sorted) {
        const count = docCount.get(chunk.atestadoId) ?? 0;
        if (count < MAX_CHUNKS_PER_DOC) {
          result.push(chunk);
          docCount.set(chunk.atestadoId, count + 1);
        }
        if (result.length >= effectiveTopK) break;
      }
    }

    if (result.length > 0) {
      const scores = result.map((r) => Number(r.similarity).toFixed(3)).join(', ');
      this.logger.log(
        `Hybrid retrieve: ${vectorRows.length} vector + ${keywordRows.length} keyword + ${strictRows.length} strict + ${fullTextRows.length} fulltext → ${result.length} final. Similarities: [${scores}]`,
      );
    } else {
      this.logger.warn(
        `No chunks found — vector=${vectorRows.length}, keyword=${keywordRows.length}, strict=${strictRows.length}, fulltext=${fullTextRows.length}. Keywords: [${keywords.join(', ')}].`,
      );
    }

    return result;
  }

  private extractKeywords(query: string): string[] {
    const STOP_WORDS = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
      'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
      'por', 'para', 'com', 'sem', 'sob', 'sobre', 'entre', 'até', 'ate',
      'que', 'qual', 'quais', 'como', 'quando', 'onde', 'quem', 'quantos', 'quanto',
      'tem', 'há', 'ha', 'ter', 'ser', 'é', 'e', 'são', 'sao',
      'me', 'te', 'se', 'nos', 'vos', 'lhe', 'lhes',
      'este', 'essa', 'isso', 'aqui', 'ali', 'mais', 'muito', 'maior', 'melhor',
      'favor', 'liste', 'listar', 'mostre', 'mostrar', 'diga', 'dizer',
      'existe', 'existem', 'encontrou', 'encontrar', 'falar', 'fale',
      // generic document-context verbs that appear in every atestado query
      'atestados', 'atestado', 'acervos', 'acervo', 'foram', 'foi', 'realizado',
      'realizados', 'realizadas', 'realizada', 'constam', 'consta', 'possui',
      'possuem', 'item', 'items', 'documentos', 'documento', 'informa', 'informar',
      'buscar', 'busca', 'procurar', 'procura', 'retornar', 'retorne',
    ]);

    return query
      .split(/\s+/)
      .map((w) => w.replace(/[.,;:?!()[\]"']/g, '').trim())
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
  }

  /**
   * Extracts only domain-specific terms (length ≥ 4, no generic words) for
   * the strict AND search. These are the service/material/code identifiers.
   */
  private extractSpecificKeywords(query: string): string[] {
    // A quoted phrase is treated as a single search term
    const quotedMatch = query.match(/"([^"]+)"/);
    if (quotedMatch) return [quotedMatch[1].trim()];

    const GENERIC_WORDS = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das',
      'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'que', 'qual',
      'quais', 'como', 'quando', 'onde', 'quem', 'tem', 'há', 'ha', 'ser',
      'é', 'e', 'são', 'sao', 'mais', 'este', 'essa', 'isso', 'muito',
      'atestados', 'atestado', 'acervos', 'acervo', 'foram', 'foi',
      'realizado', 'realizados', 'realizadas', 'realizada',
      'constam', 'consta', 'possui', 'possuem', 'item', 'items',
      'documentos', 'documento', 'qual', 'quais', 'liste', 'listar',
      'mostre', 'encontrar', 'buscar', 'procurar', 'informa',
    ]);

    return query
      .split(/\s+/)
      .map((w) => w.replace(/[.,;:?!()[\]"']/g, '').trim())
      .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w.toLowerCase()));
  }
}

