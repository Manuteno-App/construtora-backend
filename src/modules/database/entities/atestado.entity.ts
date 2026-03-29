import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Obra } from './obra.entity';
import { Chunk } from './chunk.entity';
import { ServicoExecutado } from './servico-executado.entity';

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

  @OneToMany(() => Obra, (obra) => obra.atestado)
  obras!: Obra[];

  @OneToMany(() => Chunk, (chunk) => chunk.atestado)
  chunks!: Chunk[];

  @OneToMany(() => ServicoExecutado, (s) => s.atestado)
  servicosExecutados!: ServicoExecutado[];
}
