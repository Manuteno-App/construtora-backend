import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { Obra } from '../entity/obra.entity';

export interface CreateObraData {
  atestadoId: string;
  nome: string;
  local?: string;
  tipo?: string;
  dataInicio?: Date;
  dataFim?: Date;
  valor?: number;
  art?: string;
}

@Injectable()
export class ObraRepository extends DefaultTypeOrmRepository<Obra> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Obra, dataSource);
  }

  async findByAtestadoId(atestadoId: string): Promise<Obra[]> {
    return this.find({
      where: { atestadoId },
      relations: ['contratos', 'contratos.empresa'],
    });
  }

  async createAndSave(data: CreateObraData): Promise<Obra> {
    const entity = super.create(data);
    return (await super.save(entity)) as Obra;
  }
}
