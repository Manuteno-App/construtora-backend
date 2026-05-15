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

export interface AtestadoRef {
  id: string;
  filename: string;
}

export interface QuantitativoRow {
  descricao: string;
  unidade: string | null;
  total: number;
  atestados: string[];
  atestadoRefs: AtestadoRef[];
}

export interface QuantitativoFilters {
  /** Single description filter (backward compat). */
  descricao?: string;
  /** Multiple description filters — combined with `operador`. */
  descricoes?: string[];
  /** How to combine multiple `descricoes`. Default: OR. */
  operador?: 'AND' | 'OR';
  categoria?: string;
  obraId?: string;
  /** Filters by obra.local using ILIKE. */
  localidade?: string;
  /** Only return rows where SUM(quantidade) >= minQuantidade. */
  minQuantidade?: number;
}

export interface ServiceContextResult {
  atestadoId: string;
  filename: string;
  descricao: string;
  quantidade: number | null;
  unidade: string | null;
  categoria: string | null;
  trecho: string | null;
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
    const params: unknown[] = [];
    const conditions: string[] = [];

    // Single descricao filter (backward compat)
    if (filters.descricao) {
      params.push(`%${filters.descricao}%`);
      conditions.push(`UPPER(s.descricao) LIKE UPPER($${params.length})`);
    }

    // Multi-descricao filter
    if (filters.descricoes && filters.descricoes.length > 0) {
      const op = filters.operador === 'AND' ? 'AND' : 'OR';
      const descrConds = filters.descricoes.map((d) => {
        params.push(`%${d}%`);
        return `UPPER(s.descricao) LIKE UPPER($${params.length})`;
      });
      conditions.push(`(${descrConds.join(` ${op} `)})`);
    }

    if (filters.categoria) {
      params.push(filters.categoria);
      conditions.push(`UPPER(s.categoria) = UPPER($${params.length})`);
    }

    if (filters.obraId) {
      params.push(filters.obraId);
      conditions.push(`s.obra_id = $${params.length}`);
    }

    const needsObrasJoin = !!filters.localidade;
    if (filters.localidade) {
      params.push(`%${filters.localidade}%`);
      conditions.push(`UPPER(o.local) LIKE UPPER($${params.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const obrasJoin = needsObrasJoin ? 'LEFT JOIN obras o ON o.id = s.obra_id' : '';

    let havingClause = '';
    if (filters.minQuantidade !== undefined) {
      params.push(filters.minQuantidade);
      havingClause = `HAVING SUM(outer_q.qty) >= $${params.length}`;
    }

    const sql = `
      SELECT
        outer_q.descricao,
        outer_q.unidade,
        SUM(outer_q.qty)::float AS total,
        array_agg(outer_q.atestado_id) AS atestados,
        json_agg(jsonb_build_object('id', outer_q.atestado_id, 'filename', outer_q.filename)) AS "atestadoRefs"
      FROM (
        SELECT
          s.descricao,
          s.unidade,
          s.atestado_id,
          COALESCE(MAX(a.original_filename), s.atestado_id::text) AS filename,
          SUM(s.quantidade) AS qty
        FROM servicos_executados s
        LEFT JOIN atestados a ON a.id = s.atestado_id
        ${obrasJoin}
        ${whereClause}
        GROUP BY s.descricao, s.unidade, s.atestado_id
      ) outer_q
      GROUP BY outer_q.descricao, outer_q.unidade
      ${havingClause}
      ORDER BY total DESC
    `;

    const rows = await this.query<{
      descricao: string;
      unidade: string | null;
      total: string;
      atestados: string[];
      atestadoRefs: AtestadoRef[] | string;
    }>(sql, params);

    return rows.map((r) => ({
      descricao: r.descricao,
      unidade: r.unidade,
      total: parseFloat(r.total),
      atestados: r.atestados,
      atestadoRefs: typeof r.atestadoRefs === 'string'
        ? (JSON.parse(r.atestadoRefs) as AtestadoRef[])
        : (r.atestadoRefs ?? []),
    }));
  }

  /**
   * Direct ILIKE search on descricao — used to populate LLM context when
   * vector similarity is insufficient. Accepts the raw query string and
   * extracts search terms internally.
   *
   * Fast path: when the query explicitly names a service/item (e.g. "serviço Grelha e
   * Porta-Grelha fab. TIGRE 100mm"), run a targeted ILIKE with the full phrase first —
   * before any word decomposition. This guarantees a hit when the user copies a service
   * name verbatim from the UI, regardless of how generic individual tokens are ("fab",
   * "TIGRE", etc.) and without being limited by the LIMIT 100 of the fallback path.
   */
  async searchForContext(query: string): Promise<ServiceContextResult[]> {
    const SQL = `SELECT
         s.atestado_id                                        AS "atestadoId",
         COALESCE(a.original_filename, s.atestado_id::text)  AS filename,
         s.descricao,
         s.quantidade::float                                  AS quantidade,
         s.unidade,
         s.categoria,
         s.trecho
       FROM servicos_executados s
       LEFT JOIN atestados a ON a.id = s.atestado_id
       WHERE {CONDITIONS}
       ORDER BY s.descricao, filename
       LIMIT ${'{LIMIT}'}`;

    const itemPhraseMatch = query.match(/\b(?:item|servi[çc]os?|material|insumo|produto)\s+(.{4,})/i);
    if (itemPhraseMatch) {
      const raw = itemPhraseMatch[1].replace(/[?!.]+$/, '').trim();
      if (raw.length >= 4) {
        // Normalized variant uses the SQL _ wildcard for technical symbols that may differ
        // between PDF encoding and user input (degree sign °/º, diameter Ø/ø, etc.)
        const normalized = raw.replace(/[°ºØøΦφ]/g, '_');
        const fastParams: unknown[] = normalized !== raw ? [`%${raw}%`, `%${normalized}%`] : [`%${raw}%`];
        const fastConditions = fastParams.map((_, i) => `UPPER(s.descricao) LIKE UPPER($${i + 1})`).join(' OR ');
        fastParams.push(500); // generous limit — we want ALL matching atestados

        const fastResults = await this.query<ServiceContextResult>(
          SQL.replace('{CONDITIONS}', fastConditions).replace("'{LIMIT}'", `$${fastParams.length}`),
          fastParams,
        );
        if (fastResults.length > 0) return fastResults;
        // Zero results — fall through to word-decomposition path below
      }
    }

    // Fallback: word-decomposition path for generic queries without an explicit item name
    const terms = this.extractSearchTerms(query);
    if (terms.length === 0) return [];

    const params: unknown[] = terms.map((t) => `%${t}%`);
    const conditions = terms.map((_, i) => `UPPER(s.descricao) LIKE UPPER($${i + 1})`).join(' OR ');
    params.push(100); // limit

    return this.query<ServiceContextResult>(
      SQL.replace('{CONDITIONS}', conditions).replace("'{LIMIT}'", `$${params.length}`),
      params,
    );
  }

  /**
   * Finds atestados that contain ALL services from the provided list
   * (each matched via ILIKE), optionally filtered by minimum quantity per service.
   */
  async findAtestadosComTodosServicos(
    servicos: string[],
    minQuantidade?: number,
  ): Promise<{ atestadoId: string; filename: string }[]> {
    if (servicos.length === 0) return [];

    const params: unknown[] = [];
    const havingParts: string[] = [];

    for (let i = 0; i < servicos.length; i++) {
      params.push(`%${servicos[i]}%`);
      const idx = params.length;
      if (minQuantidade !== undefined) {
        params.push(minQuantidade);
        const minIdx = params.length;
        havingParts.push(
          `SUM(CASE WHEN UPPER(s.descricao) LIKE UPPER($${idx}) AND COALESCE(s.quantidade, 0) >= $${minIdx} THEN 1 ELSE 0 END) > 0`,
        );
      } else {
        havingParts.push(
          `SUM(CASE WHEN UPPER(s.descricao) LIKE UPPER($${idx}) THEN 1 ELSE 0 END) > 0`,
        );
      }
    }

    const allConditions = servicos.map((_, i) => `UPPER(s.descricao) LIKE UPPER($${i + 1})`).join(' OR ');

    return this.query<{ atestadoId: string; filename: string }>(
      `SELECT
         s.atestado_id                                        AS "atestadoId",
         MAX(COALESCE(a.original_filename, s.atestado_id::text)) AS filename
       FROM servicos_executados s
       LEFT JOIN atestados a ON a.id = s.atestado_id
       WHERE ${allConditions}
       GROUP BY s.atestado_id
       HAVING ${havingParts.join(' AND ')}`,
      params,
    );
  }

  /**
   * Finds atestados where ALL services pass their individual minQuantidade constraint.
   * Accepts per-service filters — unlike findAtestadosComTodosServicos which uses a single minQty.
   */
  async findAtestadosComServicosFilter(
    servicos: { descricao: string; minQuantidade?: number }[],
  ): Promise<{ atestadoId: string; filename: string }[]> {
    if (servicos.length === 0) return [];

    const params: unknown[] = [];
    const havingParts: string[] = [];

    for (const s of servicos) {
      params.push(`%${s.descricao}%`);
      const descIdx = params.length;
      if (s.minQuantidade !== undefined) {
        params.push(s.minQuantidade);
        const minIdx = params.length;
        havingParts.push(
          `SUM(CASE WHEN UPPER(s.descricao) LIKE UPPER($${descIdx}) AND COALESCE(s.quantidade, 0) >= $${minIdx} THEN 1 ELSE 0 END) > 0`,
        );
      } else {
        havingParts.push(
          `SUM(CASE WHEN UPPER(s.descricao) LIKE UPPER($${descIdx}) THEN 1 ELSE 0 END) > 0`,
        );
      }
    }

    // WHERE: at least one of the services must match (for index selectivity)
    const allConditions = servicos
      .map((_, i) => `UPPER(s.descricao) LIKE UPPER($${i + 1})`)
      .join(' OR ');

    return this.query<{ atestadoId: string; filename: string }>(
      `SELECT
         s.atestado_id                                        AS "atestadoId",
         MAX(COALESCE(a.original_filename, s.atestado_id::text)) AS filename
       FROM servicos_executados s
       LEFT JOIN atestados a ON a.id = s.atestado_id
       WHERE ${allConditions}
       GROUP BY s.atestado_id
       HAVING ${havingParts.join(' AND ')}`,
      params,
    );
  }

  private extractSearchTerms(query: string): string[] {
    // Quoted phrase takes priority
    const quotedMatch = query.match(/"([^"]+)"/);
    if (quotedMatch) return [quotedMatch[1].trim()];

    const STOP_WORDS = new Set([
      'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
      'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
      'por', 'para', 'com', 'que', 'qual', 'quais', 'como', 'quando', 'onde',
      'quem', 'tem', 'há', 'ha', 'é', 'e', 'são', 'sao', 'mais', 'foram',
      'realizados', 'realizadas', 'possuem', 'possui', 'constam', 'consta',
      'item', 'atestados', 'atestado', 'acervos', 'acervo', 'existe', 'existem',
      'serviço', 'servico', 'serviços', 'servicos', 'quais', 'qual', 'sobre',
    ]);

    // When the query mentions a specific item/service by name, extract the full phrase
    // after the trigger keyword and use it as a direct LIKE condition. This guarantees
    // a match even when the item name is short, contains symbols, or individual tokens
    // are filtered out (e.g. "Te" has ≤ 2 chars, "Ø" has 1 char).
    // IMPORTANT: return early here — do NOT fall through to full-query word decomposition.
    // Mixing conversational words like "foi", "realizado", "fab" into the OR conditions
    // pollutes the result set and causes the LIMIT 100 to be consumed by irrelevant rows
    // before the target item (e.g. starting with "G") is reached alphabetically.
    const itemPhraseMatch = query.match(/\b(?:item|servi[çc]os?|material|insumo|produto)\s+(.{4,})/i);
    if (itemPhraseMatch) {
      const raw = itemPhraseMatch[1].replace(/[?!.]+$/, '').trim();
      if (raw.length >= 4) {
        const phrases: string[] = [raw];
        // Also add a normalized variant: replace technical symbols that may differ between
        // DB encoding and user input (degree sign °/º, diameter Ø/ø, etc.) with the SQL
        // wildcard %, so the LIKE pattern tolerates encoding mismatches.
        const normalized = raw.replace(/[°ºØøΦφ]/g, '%');
        if (normalized !== raw) phrases.push(normalized);

        // Extract fallback words from THE PHRASE ONLY — not the full conversational query.
        const phraseWords = raw
          .split(/\s+/)
          .map((w) => w.replace(/["'.,;:?!()\[\]]/g, '').trim())
          .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));

        return [...new Set([...phrases, ...phraseWords])];
      }
    }

    const words = query
      .split(/\s+/)
      .map((w) => w.replace(/["'.,;:?!()\[\]]/g, '').trim())
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));

    return [...new Set(words)];
  }
}
