import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Unit } from './unit.entity';

@Entity('service_unit_observations')
export class ServiceUnitObservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'atestado_id', type: 'uuid' })
  atestadoId!: string;

  @Column({ name: 'servico_executado_id', type: 'uuid', nullable: true })
  servicoExecutadoId?: string;

  @Column({ name: 'service_description', type: 'text' })
  serviceDescription!: string;

  @Column({ name: 'normalized_service_key', type: 'varchar', length: 255 })
  normalizedServiceKey!: string;

  @Column({ name: 'unit_id', type: 'uuid' })
  unitId!: string;

  @ManyToOne(() => Unit, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
  unit!: Unit;

  @Column({ type: 'numeric', precision: 18, scale: 4, nullable: true })
  quantidade?: number;

  @Column({ name: 'raw_unit_symbol', type: 'varchar', length: 255, nullable: true })
  rawUnitSymbol?: string;

  @Column({ name: 'evidence_json', type: 'text', default: '{}' })
  evidenceJson!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
