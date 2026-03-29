import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServicoExecutado } from '../../database/entities/servico-executado.entity';

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
  de?: string;
  ate?: string;
}

@Injectable()
export class QuantitativoQueryService {
  constructor(
    @InjectRepository(ServicoExecutado)
    private readonly repo: Repository<ServicoExecutado>,
  ) {}

  async query(filters: QuantitativoFilters): Promise<QuantitativoRow[]> {
    const qb = this.repo
      .createQueryBuilder('s')
      .select('s.descricao', 'descricao')
      .addSelect('s.unidade', 'unidade')
      .addSelect('SUM(s.quantidade)', 'total')
      .addSelect('array_agg(DISTINCT s.atestado_id)', 'atestados')
      .groupBy('s.descricao')
      .addGroupBy('s.unidade')
      .orderBy('total', 'DESC');

    if (filters.descricao) {
      qb.andWhere('UPPER(s.descricao) LIKE UPPER(:desc)', {
        desc: `%${filters.descricao}%`,
      });
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

  /**
   * Returns formatted markdown table of quantitativos for LLM context injection
   */
  async queryAsMarkdown(filters: QuantitativoFilters): Promise<string> {
    const rows = await this.query(filters);
    if (rows.length === 0) return '';

    const header = '| Descrição | Unidade | Total |\n|---|---|---|';
    const body = rows.map((r) => `| ${r.descricao} | ${r.unidade ?? '-'} | ${r.total} |`).join('\n');
    return `${header}\n${body}`;
  }
}
