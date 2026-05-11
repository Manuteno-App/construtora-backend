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

export interface EmpresaRankingRow {
  nome: string;
  tipo: string | null;
  atestados: number;
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

  async aggregateEmpresas(limit = 15): Promise<EmpresaRankingRow[]> {
    return this.query<EmpresaRankingRow>(
      `
      SELECT
        e.nome                               AS nome,
        e.tipo                               AS tipo,
        COUNT(DISTINCT o.atestado_id)::int   AS atestados
      FROM obras o
      JOIN contratos ct ON ct.obra_id = o.id
      JOIN empresas  e  ON e.id = ct.empresa_id
      GROUP BY e.id, e.nome, e.tipo
      ORDER BY atestados DESC
      LIMIT $1
      `,
      [limit],
    );
  }
}
