import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Chunk } from '../../../ingestion/persistence/entity/chunk.entity';

@Entity('embeddings')
export class Embedding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'chunk_id', unique: true })
  chunkId!: string;

  @OneToOne(() => Chunk, (c) => c.embedding, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chunk_id' })
  chunk!: Chunk;

  /**
   * pgvector column — stored as text at TypeORM level; the actual DB column type
   * is `vector(1536)` and is set via raw SQL in the migration.
   */
  @Column({ type: 'text', name: 'vector' })
  vector!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;
}
