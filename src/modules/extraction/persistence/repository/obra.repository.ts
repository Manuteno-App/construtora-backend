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

export interface LocalidadeAggRow {
  local: string;
  totalObras: number;
  somaValores: number | null;
  atestados: number;
}

export interface ObraContextFilter {
  /** OR match against o.local using ILIKE for each string */
  localidades?: string[];
  /** ILIKE match against o.tipo */
  tipo?: string;
  /** o.valor >= minValor */
  minValor?: number;
}

export interface ObraContextRow {
  atestadoId: string;
  filename: string;
  nome: string;
  local: string | null;
  tipo: string | null;
  valor: number | null;
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

  async aggregateValoresByLocalidade(localidade?: string): Promise<LocalidadeAggRow[]> {
    const params: unknown[] = [];
    let whereClause = '';
    if (localidade) {
      params.push(`%${localidade}%`);
      whereClause = `WHERE UPPER(o.local) LIKE UPPER($1)`;
    }
    params.push(20); // limit
    return this.query<LocalidadeAggRow>(
      `SELECT
         o.local                              AS "local",
         COUNT(DISTINCT o.id)::int           AS "totalObras",
         SUM(o.valor)::float                 AS "somaValores",
         COUNT(DISTINCT o.atestado_id)::int  AS "atestados"
       FROM obras o
       ${whereClause}
       GROUP BY o.local
       ORDER BY "atestados" DESC
       LIMIT $${params.length}`,
      params,
    );
  }

  /**
   * Returns individual obra rows (one per atestado) matching localidade, tipo and/or minValor filters.
   * Used to inject structured obra context into the LLM prompt.
   */
  async findObrasForContext(filter: ObraContextFilter): Promise<ObraContextRow[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (filter.localidades && filter.localidades.length > 0) {
      const localConds = filter.localidades.map((l) => {
        params.push(`%${l}%`);
        return `UPPER(o.local) LIKE UPPER($${params.length})`;
      });
      conditions.push(`(${localConds.join(' OR ')})`);
    }

    if (filter.tipo) {
      params.push(`%${filter.tipo}%`);
      conditions.push(`UPPER(o.tipo) LIKE UPPER($${params.length})`);
    }

    if (filter.minValor !== undefined) {
      params.push(filter.minValor);
      conditions.push(`o.valor >= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(50); // limit

    return this.query<ObraContextRow>(
      `SELECT
         o.atestado_id                                          AS "atestadoId",
         COALESCE(a.original_filename, o.atestado_id::text)    AS filename,
         o.nome,
         o.local,
         o.tipo,
         o.valor::float                                         AS valor
       FROM obras o
       LEFT JOIN atestados a ON a.id = o.atestado_id
       ${whereClause}
       ORDER BY o.valor DESC NULLS LAST
       LIMIT $${params.length}`,
      params,
    );
  }
}
