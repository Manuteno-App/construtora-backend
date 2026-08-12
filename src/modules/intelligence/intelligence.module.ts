import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QualificationModule } from '../qualification/qualification.module';
import { CapabilityChatService } from './core/service/capability-chat.service';
import { IntelligenceController } from './http/rest/controller/intelligence.controller';
import { ConversationTurn } from './persistence/entity/conversation-turn.entity';
import { ConversationTurnRepository } from './persistence/repository/conversation-turn.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationTurn]),
    QualificationModule,
  ],
  providers: [
    ConversationTurnRepository,
    CapabilityChatService,
  ],
  controllers: [IntelligenceController],
})
export class IntelligenceModule {}
