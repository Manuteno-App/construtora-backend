import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DefaultTypeOrmRepository } from '../../../../common/repository/default-typeorm.repository';
import { ServicoExecutado } from '../entity/servico-executado.entity';

export interface ServicoExecutadoRow {
  atestadoId: string;
  obraId?: string;
  trecho?: string;
  categoria?: string;
  codigo?: string;
  descricao: string;
  unidade?: string;
  quantidade?: number;
}

export interface QuantitativoRow {
  descricao: string;
  unidade: string | null;
  total: number;
  atestados: string[];
}

export interface QuantitativoFilters {
  descricao?: string;
  categoria?: string;
  obraId?: string;
}

@Injectable()
export class ServicoExecutadoRepository extends DefaultTypeOrmRepository<ServicoExecutado> {
  constructor(@InjectDataSource() dataSource: DataSource) {
    super(ServicoExecutado, dataSource);
  }

  async findByAtestadoId(atestadoId: string, categoria?: string): Promise<ServicoExecutado[]> {
    const qb = this.createQueryBuilder('s')
      .where('s.atestadoId = :atestadoId', { atestadoId })
      .orderBy('s.categoria', 'ASC')
      .addOrderBy('s.codigo', 'ASC');

    if (categoria) {
      qb.andWhere('UPPER(s.categoria) = UPPER(:categoria)', { categoria });
    }

    return qb.getMany();
  }

  async upsertMany(rows: ServicoExecutadoRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.createQueryBuilder('s')
      .insert()
      .into(ServicoExecutado)
      .values(rows as any[])
      .orIgnore()
      .execute();
  }

  async aggregateQuantitativos(filters: QuantitativoFilters): Promise<QuantitativoRow[]> {
    const qb = this.createQueryBuilder('s')
      .select('s.descricao', 'descricao')
      .addSelect('s.unidade', 'unidade')
      .addSelect('SUM(s.quantidade)', 'total')
      .addSelect('array_agg(DISTINCT s.atestado_id)', 'atestados')
      .groupBy('s.descricao')
      .addGroupBy('s.unidade')
      .orderBy('total', 'DESC');

    if (filters.descricao) {
      qb.andWhere('UPPER(s.descricao) LIKE UPPER(:desc)', { desc: `%${filters.descricao}%` });
    }
    if (filters.categoria) {
      qb.andWhere('UPPER(s.categoria) = UPPER(:cat)', { cat: filters.categoria });
    }
    if (filters.obraId) {
      qb.andWhere('s.obraId = :obraId', { obraId: filters.obraId });
    }

    const rows = await qb.getRawMany<{
      descricao: string;
      unidade: string | null;
      total: string;
      atestados: string[];
    }>();

    return rows.map((r) => ({
      descricao: r.descricao,
      unidade: r.unidade,
      total: parseFloat(r.total),
      atestados: r.atestados,
    }));
  }
}
