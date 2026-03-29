import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { Contrato } from '../entity/contrato.entity';

export interface CreateContratoData {
  obraId: string;
  empresaId: string;
  numero?: string;
  data?: Date;
  valor?: number;
}

@Injectable()
export class ContratoRepository extends DefaultTypeOrmRepository<Contrato> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Contrato, dataSource);
  }

  async createAndSave(data: CreateContratoData): Promise<Contrato> {
    const entity = super.create(data);
    return (await super.save(entity)) as Contrato;
  }
}
