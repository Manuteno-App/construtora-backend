import { RetrievedChunk, SearchFilters } from '../../persistence/repository/embedding.repository';

export interface IIndexingApi {
  embedText(text: string): Promise<number[]>;
  embedTexts(texts: string[]): Promise<number[][]>;
  toVectorLiteral(embedding: number[]): string;
  searchSimilar(vectorLiteral: string, limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]>;
  keywordSearch(keywords: string[], limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]>;
  strictKeywordSearch(keywords: string[], limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]>;
  fullTextSearch(query: string, limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]>;
}

export const INDEXING_API = Symbol('IIndexingApi');
