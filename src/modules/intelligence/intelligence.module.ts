import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chunk } from '../database/entities/chunk.entity';
import { Embedding } from '../database/entities/embedding.entity';
import { ServicoExecutado } from '../database/entities/servico-executado.entity';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';
import { HybridRetrieverService } from './services/hybrid-retriever.service';
import { ReasoningEngineService } from './services/reasoning-engine.service';
import { QuantitativoQueryService } from './services/quantitativo-query.service';
import { IntelligenceController } from './intelligence.controller';
import { IndexingModule } from '../indexing/indexing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Chunk, Embedding, ServicoExecutado, ConversationTurn]),
    IndexingModule,
  ],
  controllers: [IntelligenceController],
  providers: [HybridRetrieverService, ReasoningEngineService, QuantitativoQueryService],
})
export class IntelligenceModule {}
