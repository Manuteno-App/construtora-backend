import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExtractionModule } from '../extraction/extraction.module';
import { IndexingModule } from '../indexing/indexing.module';
import { QualificationModule } from '../qualification/qualification.module';
import { HybridRetrieverService } from './core/service/hybrid-retriever.service';
import { ReasoningEngineService } from './core/service/reasoning-engine.service';
import { IntelligenceController } from './http/rest/controller/intelligence.controller';
import { ConversationTurn } from './persistence/entity/conversation-turn.entity';
import { ConversationTurnRepository } from './persistence/repository/conversation-turn.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationTurn]),
    ExtractionModule,
    IndexingModule,
    QualificationModule,
  ],
  providers: [
    ConversationTurnRepository,
    HybridRetrieverService,
    ReasoningEngineService,
  ],
  controllers: [IntelligenceController],
})
export class IntelligenceModule {}
