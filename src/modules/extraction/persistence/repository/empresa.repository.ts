import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { Empresa, EmpresaTipo } from '../entity/empresa.entity';

@Injectable()
export class EmpresaRepository extends DefaultTypeOrmRepository<Empresa> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(Empresa, dataSource);
  }

  async findByCnpj(cnpj: string): Promise<Empresa | null> {
    return this.findOne({ where: { cnpj } });
  }

  async findOrCreate(data: {
    nome: string;
    cnpj?: string;
    tipo?: EmpresaTipo;
  }): Promise<Empresa> {
    if (data.cnpj) {
      const existing = await this.findByCnpj(data.cnpj);
      if (existing) return existing;
    }
    const entity = super.create(data);
    return (await super.save(entity)) as Empresa;
  }
}
