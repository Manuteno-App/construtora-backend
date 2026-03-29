import { RetrievedChunk } from '../../persistence/repository/embedding.repository';

export interface IIndexingApi {
  embedText(text: string): Promise<number[]>;
  embedTexts(texts: string[]): Promise<number[][]>;
  toVectorLiteral(embedding: number[]): string;
  searchSimilar(vectorLiteral: string, limit: number): Promise<RetrievedChunk[]>;
  keywordSearch(keywords: string[], limit: number): Promise<RetrievedChunk[]>;
}

export const INDEXING_API = Symbol('IIndexingApi');
