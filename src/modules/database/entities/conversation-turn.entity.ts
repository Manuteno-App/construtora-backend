import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export enum ConversationRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
}

@Entity('conversation_turns')
@Index(['sessionId', 'createdAt'])
export class ConversationTurn {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'session_id' })
  sessionId!: string;

  @Column({ type: 'enum', enum: ConversationRole })
  role!: ConversationRole;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'jsonb', nullable: true })
  sources?: Record<string, unknown>[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
