import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Atestado } from '../../../documents/persistence/entity/atestado.entity';
import { Obra } from './obra.entity';
import { Unit } from '../../../measurements/persistence/entity/unit.entity';

@Entity('servicos_executados')
@Unique(['atestadoId', 'codigo', 'trecho'])
export class ServicoExecutado {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'atestado_id' })
  atestadoId!: string;

  @Column({ name: 'obra_id', nullable: true })
  obraId?: string;

  @ManyToOne(() => Atestado, (a) => a.servicosExecutados, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'atestado_id' })
  atestado!: Atestado;

  @ManyToOne(() => Obra, (o) => o.servicosExecutados, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'obra_id' })
  obra?: Obra;

  @Column({ nullable: true, type: 'text' })
  trecho?: string;

  @Column({ nullable: true })
  categoria?: string;

  @Column({ nullable: true })
  codigo?: string;

  @Column({ type: 'text' })
  descricao!: string;

  @Column({ nullable: true })
  unidade?: string;

  @Column({ name: 'unit_id', nullable: true })
  unitId?: string;

  @ManyToOne(() => Unit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  @Column({ name: 'unit_symbol_raw', nullable: true })
  unitSymbolRaw?: string;

  @Column({ name: 'normalized_service_key', nullable: true })
  normalizedServiceKey?: string;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  quantidade?: number;
}
