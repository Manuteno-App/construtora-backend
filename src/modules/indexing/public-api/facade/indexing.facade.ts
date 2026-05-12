import { Injectable } from '@nestjs/common';
import { EmbeddingService } from '../../core/service/embedding.service';
import { EmbeddingRepository, RetrievedChunk } from '../../persistence/repository/embedding.repository';
import { IIndexingApi } from '../interface/indexing-api.interface';

@Injectable()
export class IndexingFacade implements IIndexingApi {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingRepo: EmbeddingRepository,
  ) {}

  embedText(text: string): Promise<number[]> {
    return this.embeddingService.embedSingle(text);
  }

  embedTexts(texts: string[]): Promise<number[][]> {
    return this.embeddingService.embedTexts(texts);
  }

  toVectorLiteral(embedding: number[]): string {
    return this.embeddingService.toVectorLiteral(embedding);
  }

  searchSimilar(vectorLiteral: string, limit: number): Promise<RetrievedChunk[]> {
    return this.embeddingRepo.vectorSearch(vectorLiteral, limit);
  }

  keywordSearch(keywords: string[], limit: number): Promise<RetrievedChunk[]> {
    return this.embeddingRepo.keywordSearch(keywords, limit);
  }

  strictKeywordSearch(keywords: string[], limit: number): Promise<RetrievedChunk[]> {
    return this.embeddingRepo.strictKeywordSearch(keywords, limit);
  }
}
