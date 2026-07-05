import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UnitFamily } from './unit-family.entity';
import { UnitConversion } from './unit-conversion.entity';
import { TechnicalUnitConversion } from './technical-unit-conversion.entity';

export enum UnitStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum UnitOrigin {
  SYSTEM = 'SYSTEM',
  AI = 'AI',
  USER = 'USER',
}

@Entity('units')
export class Unit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ name: 'canonical_symbol', type: 'varchar', length: 40, unique: true })
  canonicalSymbol!: string;

  @Column({ name: 'normalized_symbol', type: 'varchar', length: 40, unique: true })
  normalizedSymbol!: string;

  @Column({ name: 'aliases_json', type: 'text', default: '[]' })
  aliasesJson!: string;

  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @ManyToOne(() => UnitFamily, (family) => family.units, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'family_id' })
  family!: UnitFamily;

  @Column({
    type: 'enum',
    enum: UnitStatus,
    default: UnitStatus.ACTIVE,
  })
  status!: UnitStatus;

  @Column({
    type: 'enum',
    enum: UnitOrigin,
    default: UnitOrigin.SYSTEM,
  })
  origin!: UnitOrigin;

  @OneToMany(() => UnitConversion, (conversion) => conversion.sourceUnit)
  sourceConversions!: UnitConversion[];

  @OneToMany(() => UnitConversion, (conversion) => conversion.targetUnit)
  targetConversions!: UnitConversion[];

  @OneToMany(() => TechnicalUnitConversion, (conversion) => conversion.sourceUnit)
  sourceTechnicalConversions!: TechnicalUnitConversion[];

  @OneToMany(() => TechnicalUnitConversion, (conversion) => conversion.targetUnit)
  targetTechnicalConversions!: TechnicalUnitConversion[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
