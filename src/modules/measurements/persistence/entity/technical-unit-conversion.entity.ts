import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { RuleOrigin } from './unit-conversion.entity';
import { Unit } from './unit.entity';

export enum TechnicalUnitConversionStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  INACTIVE = 'INACTIVE',
}

@Entity('technical_unit_conversions')
@Unique(['normalizedServiceKey', 'sourceUnitId', 'targetUnitId'])
export class TechnicalUnitConversion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'service_description', type: 'text' })
  serviceDescription!: string;

  @Column({ name: 'normalized_service_key', type: 'varchar', length: 255 })
  normalizedServiceKey!: string;

  @Column({ name: 'source_unit_id', type: 'uuid' })
  sourceUnitId!: string;

  @Column({ name: 'target_unit_id', type: 'uuid' })
  targetUnitId!: string;

  @ManyToOne(() => Unit, (unit) => unit.sourceTechnicalConversions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_unit_id' })
  sourceUnit!: Unit;

  @ManyToOne(() => Unit, (unit) => unit.targetTechnicalConversions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_unit_id' })
  targetUnit!: Unit;

  @Column({ type: 'numeric', precision: 20, scale: 10 })
  factor!: number;

  @Column({
    name: 'rule_origin',
    type: 'enum',
    enum: RuleOrigin,
    default: RuleOrigin.AI,
  })
  ruleOrigin!: RuleOrigin;

  @Column({
    type: 'enum',
    enum: TechnicalUnitConversionStatus,
    default: TechnicalUnitConversionStatus.PENDING,
  })
  status!: TechnicalUnitConversionStatus;

  @Column({ name: 'evidence_json', type: 'text', default: '{}' })
  evidenceJson!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
