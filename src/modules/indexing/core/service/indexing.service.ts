import { Injectable, Inject, Logger } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { EmbeddingRepository } from '../../persistence/repository/embedding.repository';
import { IIngestionApi, INGESTION_API } from '../../../ingestion/public-api/interface/ingestion-api.interface';
import { IDocumentsApi, DOCUMENTS_API } from '../../../documents/public-api/interface/documents-api.interface';
import { AtestadoStatus } from '../../../documents/persistence/entity/atestado.entity';

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingRepo: EmbeddingRepository,
    @Inject(INGESTION_API) private readonly ingestionApi: IIngestionApi,
    @Inject(DOCUMENTS_API) private readonly documentsApi: IDocumentsApi,
  ) {}

  async indexAtestado(atestadoId: string): Promise<void> {
    try {
      const chunks = await this.ingestionApi.getUnembeddedChunksByAtestadoId(atestadoId);

      if (chunks.length === 0) {
        this.logger.log(`No unembedded chunks for ${atestadoId}`);
      } else {
        const texts = chunks.map((c) => c.content);
        const embeddings = await this.embeddingService.embedTexts(texts);

        await this.embeddingRepo.saveMany(
          chunks.map((chunk, i) => ({
            chunkId: chunk.id,
            vector: this.embeddingService.toVectorLiteral(embeddings[i]),
            metadata: {
              atestadoId: chunk.atestadoId,
              chunkIndex: chunk.chunkIndex,
              pageNumber: chunk.pageNumber,
              originalFilename: chunk.originalFilename,
            },
          })),
        );

        this.logger.log(`Saved ${chunks.length} embeddings for ${atestadoId}`);
      }

      await this.documentsApi.updateAtestadoStatus(atestadoId, AtestadoStatus.DONE);
      this.logger.log(`Indexing DONE for ${atestadoId}`);
    } catch (err) {
      this.logger.error(`Indexing failed for ${atestadoId}`, err);
      await this.documentsApi.updateAtestadoStatus(
        atestadoId,
        AtestadoStatus.ERROR,
        String(err),
      );
      throw err;
    }
  }
}
