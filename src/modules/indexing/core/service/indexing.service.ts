import { Inject, Injectable, Logger } from '@nestjs/common';
import { AtestadoStatus } from '../../../documents/persistence/entity/atestado.entity';
import { DOCUMENTS_API, IDocumentsApi } from '../../../documents/public-api/interface/documents-api.interface';
import { IIngestionApi, INGESTION_API } from '../../../ingestion/public-api/interface/ingestion-api.interface';
import { EmbeddingRepository } from '../../persistence/repository/embedding.repository';
import { EmbeddingService } from './embedding.service';

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
        const validChunks = chunks.filter((c) => c.content.trim().length > 0);
        if (validChunks.length === 0) {
          this.logger.warn(`All chunks are empty for ${atestadoId}, skipping embedding`);
        } else {
          const texts = validChunks.map((c) => c.content);
          const embeddings = await this.embeddingService.embedTexts(texts);

          await this.embeddingRepo.saveMany(
            validChunks.map((chunk, i) => ({
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

          this.logger.log(`Saved ${validChunks.length} embeddings for ${atestadoId}`);
        }
      }

      await this.documentsApi.updateAtestadoStatus(atestadoId, AtestadoStatus.DONE, null);
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
