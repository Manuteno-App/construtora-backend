import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Atestado } from '../../../documents/persistence/entity/atestado.entity';
import { Contrato } from './contrato.entity';
import { ServicoExecutado } from './servico-executado.entity';

@Entity('obras')
export class Obra {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'atestado_id' })
  atestadoId!: string;

  @ManyToOne(() => Atestado, (a) => a.obras, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'atestado_id' })
  atestado!: Atestado;

  @Column()
  nome!: string;

  @Column({ nullable: true, type: 'text' })
  local?: string;

  @Column({ nullable: true, type: 'text' })
  tipo?: string;

  @Column({ name: 'data_inicio', nullable: true, type: 'date' })
  dataInicio?: Date;

  @Column({ name: 'data_fim', nullable: true, type: 'date' })
  dataFim?: Date;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  valor?: number;

  @Column({ nullable: true })
  art?: string;

  @OneToMany(() => Contrato, (c) => c.obra)
  contratos!: Contrato[];

  @OneToMany(() => ServicoExecutado, (s) => s.obra)
  servicosExecutados!: ServicoExecutado[];
}
