import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Contrato } from './contrato.entity';

export enum EmpresaTipo {
  CONTRATANTE = 'CONTRATANTE',
  CONTRATADA = 'CONTRATADA',
}

@Entity('empresas')
export class Empresa {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  nome!: string;

  @Column({ unique: true, nullable: true })
  cnpj?: string;

  @Column({ type: 'enum', enum: EmpresaTipo, nullable: true })
  tipo?: EmpresaTipo;

  @OneToMany(() => Contrato, (c) => c.empresa)
  contratos!: Contrato[];
}
