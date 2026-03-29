import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { ConversationTurn, ConversationRole } from '../entity/conversation-turn.entity';

@Injectable()
export class ConversationTurnRepository extends DefaultTypeOrmRepository<ConversationTurn> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(ConversationTurn, dataSource);
  }

  async findBySessionIdOrdered(sessionId: string): Promise<ConversationTurn[]> {
    return this.find({ where: { sessionId }, order: { createdAt: 'ASC' } });
  }

  async findRecentBySessionId(sessionId: string, limit: number): Promise<ConversationTurn[]> {
    return this.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async saveTurn(data: {
    sessionId: string;
    role: ConversationRole;
    content: string;
    sources?: Record<string, unknown>[];
  }): Promise<ConversationTurn> {
    const entity = super.create(data);
    return (await super.save(entity)) as ConversationTurn;
  }
}
