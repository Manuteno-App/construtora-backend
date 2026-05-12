import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RetrievedChunk } from '../../../indexing/persistence/repository/embedding.repository';
import { IIndexingApi, INDEXING_API } from '../../../indexing/public-api/interface/indexing-api.interface';

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
    const specificKeywords = this.extractSpecificKeywords(query);
    this.logger.log(`Keywords: [${keywords.join(', ')}]  Specific: [${specificKeywords.join(', ')}]`);

    const queryVector = await this.indexingApi.embedText(query);
    const vectorLiteral = this.indexingApi.toVectorLiteral(queryVector);

    const [vectorRows, keywordRows, strictRows] = await Promise.all([
      this.indexingApi.searchSimilar(vectorLiteral, this.topK),
      keywords.length > 0
        ? this.indexingApi.keywordSearch(keywords, this.topK)
        : Promise.resolve<RetrievedChunk[]>([]),
      specificKeywords.length >= 2
        ? this.indexingApi.strictKeywordSearch(specificKeywords, this.topK)
        : Promise.resolve<RetrievedChunk[]>([]),
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

    const result = Array.from(merged.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.topK);

    if (result.length > 0) {
      const scores = result.map((r) => Number(r.similarity).toFixed(3)).join(', ');
      this.logger.log(
        `Hybrid retrieve: ${vectorRows.length} vector + ${keywordRows.length} keyword + ${strictRows.length} strict → ${result.length} final. Similarities: [${scores}]`,
      );
    } else {
      this.logger.warn(
        `No chunks found — vector=${vectorRows.length}, keyword=${keywordRows.length}, strict=${strictRows.length}. Keywords: [${keywords.join(', ')}].`,
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

