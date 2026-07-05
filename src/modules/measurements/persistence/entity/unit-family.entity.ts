import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Unit } from './unit.entity';

export enum UnitFamilyStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity('unit_families')
export class UnitFamily {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  name!: string;

  @Column({ type: 'varchar', length: 120, unique: true })
  slug!: string;

  @Column({
    type: 'enum',
    enum: UnitFamilyStatus,
    default: UnitFamilyStatus.ACTIVE,
  })
  status!: UnitFamilyStatus;

  @OneToMany(() => Unit, (unit) => unit.family)
  units!: Unit[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
