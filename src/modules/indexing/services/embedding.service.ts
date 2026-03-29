import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly openai: OpenAI;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly batchSize: number;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.get<string>('openaiApiKey') });
    this.model = config.get<string>('embedding.model') ?? 'text-embedding-3-small';
    this.dimensions = config.get<number>('embedding.dimensions') ?? 1536;
    this.batchSize = config.get<number>('embedding.batchSize') ?? 20;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      this.logger.debug(`Embedding batch ${i / this.batchSize + 1} (${batch.length} texts)`);

      const response = await this.openai.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      });

      // OpenAI returns results in order
      results.push(...response.data.map((d) => d.embedding));
    }

    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embedTexts([text]);
    return embedding;
  }

  /**
   * Format a float array as pgvector literal: '[0.1,0.2,...]'
   */
  static toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  /**
   * Compute cosine similarity between two vectors
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }
}
