import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { Atestado } from '../../../documents/persistence/entity/atestado.entity';
import { Embedding } from '../../../indexing/persistence/entity/embedding.entity';

@Entity('chunks')
export class Chunk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'atestado_id' })
  atestadoId!: string;

  @ManyToOne(() => Atestado, (a) => a.chunks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'atestado_id' })
  atestado!: Atestado;

  @Column({ name: 'original_filename' })
  originalFilename!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'chunk_index' })
  chunkIndex!: number;

  @Column({ name: 'page_number', nullable: true, type: 'int' })
  pageNumber?: number;

  @OneToOne(() => Embedding, (e) => e.chunk)
  embedding?: Embedding;
}
