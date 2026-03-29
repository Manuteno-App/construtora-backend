import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Obra } from './obra.entity';
import { Empresa } from './empresa.entity';

@Entity('contratos')
export class Contrato {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'obra_id' })
  obraId!: string;

  @Column({ name: 'empresa_id' })
  empresaId!: string;

  @ManyToOne(() => Obra, (o) => o.contratos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'obra_id' })
  obra!: Obra;

  @ManyToOne(() => Empresa, (e) => e.contratos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'empresa_id' })
  empresa!: Empresa;

  @Column({ nullable: true })
  numero?: string;

  @Column({ nullable: true, type: 'date' })
  data?: Date;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  valor?: number;
}
