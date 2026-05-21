import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Obra } from '../../../extraction/persistence/entity/obra.entity';
import { ServicoExecutado } from '../../../extraction/persistence/entity/servico-executado.entity';
import { Chunk } from '../../../ingestion/persistence/entity/chunk.entity';

export enum AtestadoStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  DONE = 'DONE',
  ERROR = 'ERROR',
}

@Entity('atestados')
export class Atestado {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 's3_key' })
  s3Key!: string;

  @Column({ name: 'original_filename' })
  originalFilename!: string;

  @Column({ type: 'enum', enum: AtestadoStatus, default: AtestadoStatus.PENDING })
  status!: AtestadoStatus;

  @Column({ nullable: true, type: 'text', name: 'error_message' })
  errorMessage?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'last_reprocessed_at', type: 'timestamptz', nullable: true })
  lastReprocessedAt?: Date;

  @OneToMany(() => Obra, (obra) => obra.atestado)
  obras!: Obra[];

  @OneToMany(() => Chunk, (chunk) => chunk.atestado)
  chunks!: Chunk[];

  @OneToMany(() => ServicoExecutado, (s) => s.atestado)
  servicosExecutados!: ServicoExecutado[];
}
