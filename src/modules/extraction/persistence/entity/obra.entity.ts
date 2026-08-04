import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
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
  cidade?: string;

  @Column({ nullable: true, length: 2 })
  estado?: string;

  @Column({ nullable: true, type: 'text' })
  tipo?: string;

  @Column({ name: 'data_inicio', nullable: true, type: 'date' })
  dataInicio?: Date;

  @Column({ name: 'data_fim', nullable: true, type: 'date' })
  dataFim?: Date;

  @Column({ name: 'data_atestado', nullable: true, type: 'date' })
  dataAtestado?: Date;

  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true })
  valor?: number;

  @Column({ name: 'valor_atestado', type: 'numeric', precision: 18, scale: 2, nullable: true })
  valorAtestado?: number;

  @Column({ nullable: true, type: 'text' })
  cliente?: string;

  @Column({ nullable: true, type: 'text' })
  engenheiro?: string;

  @Column({ nullable: true })
  art?: string;

  @Column({ name: 'numero_atestado', nullable: true, type: 'text' })
  numeroAtestado?: string;

  @Column({ name: 'extensao_declarada_km', nullable: true, type: 'numeric', precision: 14, scale: 4 })
  extensaoDeclaradaKm?: number;

  @Column({ name: 'km_inicial', nullable: true, type: 'numeric', precision: 14, scale: 4 })
  kmInicial?: number;

  @Column({ name: 'km_final', nullable: true, type: 'numeric', precision: 14, scale: 4 })
  kmFinal?: number;

  @Column({ name: 'extensao_calculada_km', nullable: true, type: 'numeric', precision: 14, scale: 4 })
  extensaoCalculadaKm?: number;

  @Column({ name: 'extensao_km', nullable: true, type: 'numeric', precision: 14, scale: 4 })
  extensaoKm?: number;

  @OneToMany(() => Contrato, (c) => c.obra)
  contratos!: Contrato[];

  @OneToMany(() => ServicoExecutado, (s) => s.obra)
  servicosExecutados!: ServicoExecutado[];
}
