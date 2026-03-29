import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
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
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      });
      results.push(...response.data.map((d) => d.embedding));
    }
    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embedTexts([text]);
    return embedding;
  }

  toVectorLiteral(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
