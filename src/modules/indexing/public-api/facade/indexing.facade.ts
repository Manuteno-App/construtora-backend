import { Injectable } from '@nestjs/common';
import { EmbeddingService } from '../../core/service/embedding.service';
import { EmbeddingRepository, RetrievedChunk, SearchFilters } from '../../persistence/repository/embedding.repository';
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

  searchSimilar(vectorLiteral: string, limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]> {
    return this.embeddingRepo.vectorSearch(vectorLiteral, limit, filters);
  }

  keywordSearch(keywords: string[], limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]> {
    return this.embeddingRepo.keywordSearch(keywords, limit, filters);
  }

  strictKeywordSearch(keywords: string[], limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]> {
    return this.embeddingRepo.strictKeywordSearch(keywords, limit, filters);
  }

  fullTextSearch(query: string, limit: number, filters?: SearchFilters): Promise<RetrievedChunk[]> {
    return this.embeddingRepo.fullTextSearch(query, limit, filters);
  }
}
