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
    const normalized = cnpj.replace(/\D/g, '');
    if (!normalized) return null;
    const rows = await this.query<Empresa>(
      "SELECT * FROM empresas WHERE regexp_replace(COALESCE(cnpj, ''), '\\D', '', 'g') = $1 LIMIT 1",
      [normalized],
    );
    return rows[0] ?? null;
  }

  async findOrCreate(data: {
    nome: string;
    cnpj?: string;
    tipo?: EmpresaTipo;
  }): Promise<Empresa> {
    const cnpj = data.cnpj?.replace(/\D/g, '') || undefined;
    if (cnpj) {
      const existing = await this.findByCnpj(cnpj);
      if (existing) return existing;
    }
    const entity = super.create({ ...data, cnpj });
    return (await super.save(entity)) as Empresa;
  }
}
