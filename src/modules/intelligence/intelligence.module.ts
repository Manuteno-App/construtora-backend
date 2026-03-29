import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationTurn } from './persistence/entity/conversation-turn.entity';
import { ConversationTurnRepository } from './persistence/repository/conversation-turn.repository';
import { HybridRetrieverService } from './core/service/hybrid-retriever.service';
import { ReasoningEngineService } from './core/service/reasoning-engine.service';
import { IntelligenceController } from './http/rest/controller/intelligence.controller';
import { ExtractionModule } from '../extraction/extraction.module';
import { IndexingModule } from '../indexing/indexing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationTurn]),
    ExtractionModule,
    IndexingModule,
  ],
  providers: [
    ConversationTurnRepository,
    HybridRetrieverService,
    ReasoningEngineService,
  ],
  controllers: [IntelligenceController],
})
export class IntelligenceModule {}
