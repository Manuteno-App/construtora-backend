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
import { Unit } from './unit.entity';

export enum UnitConversionType {
  MATHEMATICAL = 'MATHEMATICAL',
}

export enum RuleOrigin {
  SYSTEM = 'SYSTEM',
  AI = 'AI',
  USER = 'USER',
}

@Entity('unit_conversions')
@Unique(['sourceUnitId', 'targetUnitId', 'type'])
export class UnitConversion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_unit_id', type: 'uuid' })
  sourceUnitId!: string;

  @Column({ name: 'target_unit_id', type: 'uuid' })
  targetUnitId!: string;

  @ManyToOne(() => Unit, (unit) => unit.sourceConversions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'source_unit_id' })
  sourceUnit!: Unit;

  @ManyToOne(() => Unit, (unit) => unit.targetConversions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'target_unit_id' })
  targetUnit!: Unit;

  @Column({ type: 'numeric', precision: 20, scale: 10 })
  factor!: number;

  @Column({
    type: 'enum',
    enum: UnitConversionType,
    default: UnitConversionType.MATHEMATICAL,
  })
  type!: UnitConversionType;

  @Column({
    name: 'rule_origin',
    type: 'enum',
    enum: RuleOrigin,
    default: RuleOrigin.SYSTEM,
  })
  ruleOrigin!: RuleOrigin;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
