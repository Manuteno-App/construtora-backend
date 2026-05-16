import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
    BundleCoverageResult,
    CumulativeResult,
    QualificationFilters,
    QualificationSource,
    ResolvedDescricao,
    ServiceCoverage,
    ServiceRequirement,
    ServicoBuscado,
} from '../../public-api/interface/qualification-api.interface';

interface QualificationSourceRow {
  atestadoId: string;
  filename: string;
  obraNome: string | null;
  local: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  valor: string | number | null;
  contratoNumero: string | null;
}

interface AtestadoDetailsRow {
  id: string;
  filename: string;
  status: string;
  createdAt: string;
  obraNome: string | null;
  local: string | null;
  tipo: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  valor: string | null;
  contratoNumero: string | null;
  totalServicos: string;
}

@Injectable()
export class QualificationService {
  private readonly logger = new Logger(QualificationService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async resolveDescricoes(query: string): Promise<ResolvedDescricao[]> {
    const ilikePat = `%${query.trim()}%`;
    try {
      const rows = await this.dataSource.query<{ descricao: string; score: string }[]>(
        `SELECT DISTINCT s.descricao,
           COALESCE(ts_rank(s.descricao_tsv, plainto_tsquery('portuguese', $1)), 0) AS score
         FROM servicos_executados s
         WHERE s.descricao_tsv @@ plainto_tsquery('portuguese', $1)
            OR UPPER(s.descricao) LIKE UPPER($2)
         ORDER BY score DESC
         LIMIT 30`,
        [query.trim(), ilikePat],
      );
      return rows.map((r) => ({ descricao: r.descricao, score: parseFloat(r.score) }));
    } catch {
      this.logger.warn('FTS column unavailable, falling back to ILIKE-only for resolveDescricoes');
      const rows = await this.dataSource.query<{ descricao: string }[]>(
        `SELECT DISTINCT s.descricao FROM servicos_executados s WHERE UPPER(s.descricao) LIKE UPPER($1) LIMIT 30`,
        [ilikePat],
      );
      return rows.map((r) => ({ descricao: r.descricao, score: 0 }));
    }
  }

  async findAtestadosComServico(
    descricoes: string[],
    filters?: QualificationFilters,
  ): Promise<QualificationSource[]> {
    if (descricoes.length === 0) return [];

    const params: unknown[] = [];
    const ilikeConds = descricoes.map((d) => {
      params.push(`%${d}%`);
      return `UPPER(s.descricao) LIKE UPPER($${params.length})`;
    });
    const filterClauses = this.buildFilterClauses(filters, params);
    const whereParts = [`(${ilikeConds.join(' OR ')})`, ...filterClauses];

    const rows = await this.dataSource.query<QualificationSourceRow[]>(
      `SELECT
         a.id AS "atestadoId",
         a.original_filename AS filename,
         MAX(o.nome) AS "obraNome",
         MAX(o.local) AS local,
         MIN(o.data_inicio::text) AS "dataInicio",
         MAX(o.data_fim::text) AS "dataFim",
         MAX(o.valor) AS valor,
         (SELECT c.numero FROM contratos c
          INNER JOIN obras o2 ON o2.id = c.obra_id
          WHERE o2.atestado_id = a.id LIMIT 1) AS "contratoNumero"
       FROM servicos_executados s
       JOIN atestados a ON a.id = s.atestado_id AND a.status = 'DONE'
       LEFT JOIN obras o ON o.id = s.obra_id
       WHERE ${whereParts.join(' AND ')}
       GROUP BY a.id, a.original_filename
       ORDER BY a.original_filename`,
      params,
    );
    const sources = this.mapRows(rows);
    const servicosMap = await this.fetchServicosParaAtestados(sources.map((s) => s.atestadoId), descricoes);
    return sources.map((s) => ({ ...s, servicos: servicosMap.get(s.atestadoId) ?? [] }));
  }

  async findAtestadosComQuantidadeMinima(
    descricoes: string[],
    minQty: number,
    filters?: QualificationFilters,
  ): Promise<QualificationSource[]> {
    if (descricoes.length === 0) return [];

    const params: unknown[] = [];
    const ilikeConds = descricoes.map((d) => {
      params.push(`%${d}%`);
      return `UPPER(s.descricao) LIKE UPPER($${params.length})`;
    });
    const filterClauses = this.buildFilterClauses(filters, params);
    const whereParts = [`(${ilikeConds.join(' OR ')})`, ...filterClauses];
    params.push(minQty);
    const minQtyParam = params.length;

    const rows = await this.dataSource.query<(QualificationSourceRow & { totalQuantidade: string })[]>(
      `SELECT
         a.id AS "atestadoId",
         a.original_filename AS filename,
         MAX(o.nome) AS "obraNome",
         MAX(o.local) AS local,
         MIN(o.data_inicio::text) AS "dataInicio",
         MAX(o.data_fim::text) AS "dataFim",
         MAX(o.valor) AS valor,
         (SELECT c.numero FROM contratos c
          INNER JOIN obras o2 ON o2.id = c.obra_id
          WHERE o2.atestado_id = a.id LIMIT 1) AS "contratoNumero",
         SUM(s.quantidade) AS "totalQuantidade"
       FROM servicos_executados s
       JOIN atestados a ON a.id = s.atestado_id AND a.status = 'DONE'
       LEFT JOIN obras o ON o.id = s.obra_id
       WHERE ${whereParts.join(' AND ')}
       GROUP BY a.id, a.original_filename
       HAVING SUM(s.quantidade) >= $${minQtyParam}
       ORDER BY "totalQuantidade" DESC`,
      params,
    );
    const sources = this.mapRows(rows);
    const servicosMap = await this.fetchServicosParaAtestados(sources.map((s) => s.atestadoId), descricoes);
    return sources.map((s) => ({ ...s, servicos: servicosMap.get(s.atestadoId) ?? [] }));
  }

  async findCumulativoAtestados(
    descricoes: string[],
    minQty: number,
    filters?: QualificationFilters,
  ): Promise<CumulativeResult> {
    if (descricoes.length === 0) {
      return { atestados: [], totalQuantidade: 0, meetsMinimum: false, minQuantidade: minQty };
    }

    const params: unknown[] = [];
    const ilikeConds = descricoes.map((d) => {
      params.push(`%${d}%`);
      return `UPPER(s.descricao) LIKE UPPER($${params.length})`;
    });
    const filterClauses = this.buildFilterClauses(filters, params);
    const whereParts = [`(${ilikeConds.join(' OR ')})`, ...filterClauses];

    const rows = await this.dataSource.query<(QualificationSourceRow & { totalQuantidade: string })[]>(
      `SELECT
         a.id AS "atestadoId",
         a.original_filename AS filename,
         MAX(o.nome) AS "obraNome",
         MAX(o.local) AS local,
         MIN(o.data_inicio::text) AS "dataInicio",
         MAX(o.data_fim::text) AS "dataFim",
         MAX(o.valor) AS valor,
         (SELECT c.numero FROM contratos c
          INNER JOIN obras o2 ON o2.id = c.obra_id
          WHERE o2.atestado_id = a.id LIMIT 1) AS "contratoNumero",
         SUM(s.quantidade) AS "totalQuantidade"
       FROM servicos_executados s
       JOIN atestados a ON a.id = s.atestado_id AND a.status = 'DONE'
       LEFT JOIN obras o ON o.id = s.obra_id
       WHERE ${whereParts.join(' AND ')}
       GROUP BY a.id, a.original_filename
       ORDER BY "totalQuantidade" DESC`,
      params,
    );

    const totalQuantidade = rows.reduce((sum, r) => sum + (parseFloat(r.totalQuantidade) || 0), 0);
    const sources = this.mapRows(rows);
    const servicosMap = await this.fetchServicosParaAtestados(sources.map((s) => s.atestadoId), descricoes);
    const enrichedSources = sources.map((s) => ({ ...s, servicos: servicosMap.get(s.atestadoId) ?? [] }));
    return {
      atestados: enrichedSources,
      totalQuantidade,
      meetsMinimum: totalQuantidade >= minQty,
      minQuantidade: minQty,
    };
  }

  async findBundleSingleCoverage(
    services: ServiceRequirement[],
    filters?: QualificationFilters,
  ): Promise<BundleCoverageResult> {
    if (services.length === 0) {
      return { minimumSet: [], coverageByService: [], fullyQualified: false };
    }

    // Resolve descriptions for each service
    const resolvedServices = await Promise.all(
      services.map(async (svc) => {
        const resolved = await this.resolveDescricoes(svc.query);
        const topDescricoes = resolved.slice(0, 5).map((r) => r.descricao);
        return {
          query: svc.query,
          minQuantidade: svc.minQuantidade,
          resolvedDescricoes: topDescricoes.length > 0 ? topDescricoes : [svc.query],
        };
      }),
    );

    // For each service, find qualifying atestados
    const perServiceAtestados: { query: string; atestados: QualificationSource[] }[] = [];
    for (const svc of resolvedServices) {
      const atestados =
        svc.minQuantidade !== undefined
          ? await this.findAtestadosComQuantidadeMinima(svc.resolvedDescricoes, svc.minQuantidade, filters)
          : await this.findAtestadosComServico(svc.resolvedDescricoes, filters);
      perServiceAtestados.push({ query: svc.query, atestados });
    }

    // Build atestado → covered services map
    const atestadoCoverage = new Map<string, Set<string>>();
    const atestadoDetails = new Map<string, QualificationSource>();
    for (const { query, atestados } of perServiceAtestados) {
      for (const a of atestados) {
        if (!atestadoCoverage.has(a.atestadoId)) atestadoCoverage.set(a.atestadoId, new Set());
        atestadoCoverage.get(a.atestadoId)!.add(query);
        if (!atestadoDetails.has(a.atestadoId)) atestadoDetails.set(a.atestadoId, a);
      }
    }

    // Greedy set cover
    const uncovered = new Set(services.map((s) => s.query));
    const selected = new Map<string, QualificationSource>();

    while (uncovered.size > 0) {
      let bestId: string | null = null;
      let bestCount = 0;
      for (const [id, coveredByAtestado] of atestadoCoverage) {
        if (selected.has(id)) continue;
        const newCount = [...coveredByAtestado].filter((q) => uncovered.has(q)).length;
        if (newCount > bestCount) {
          bestCount = newCount;
          bestId = id;
        }
      }
      if (!bestId || bestCount === 0) break;
      selected.set(bestId, atestadoDetails.get(bestId)!);
      for (const q of atestadoCoverage.get(bestId)!) uncovered.delete(q);
    }

    // Compute per-service coverage after selection
    const coveredBySelection = new Set<string>();
    for (const [id] of selected) {
      for (const q of atestadoCoverage.get(id) ?? []) coveredBySelection.add(q);
    }

    const coverageByService: ServiceCoverage[] = resolvedServices.map((svc, i) => ({
      serviceQuery: svc.query,
      resolvedDescricoes: svc.resolvedDescricoes,
      qualifyingAtestados: perServiceAtestados[i].atestados,
      covered: coveredBySelection.has(svc.query),
    }));

    return {
      minimumSet: [...selected.values()],
      coverageByService,
      fullyQualified: uncovered.size === 0,
    };
  }

  async findBundleCumulativeCoverage(
    services: ServiceRequirement[],
    filters?: QualificationFilters,
  ): Promise<ServiceCoverage[]> {
    if (services.length === 0) return [];

    const resolvedServices = await Promise.all(
      services.map(async (svc) => {
        const resolved = await this.resolveDescricoes(svc.query);
        const topDescricoes = resolved.slice(0, 5).map((r) => r.descricao);
        return {
          query: svc.query,
          minQuantidade: svc.minQuantidade,
          resolvedDescricoes: topDescricoes.length > 0 ? topDescricoes : [svc.query],
        };
      }),
    );

    const results: ServiceCoverage[] = [];
    for (const svc of resolvedServices) {
      if (svc.minQuantidade !== undefined) {
        const cumul = await this.findCumulativoAtestados(svc.resolvedDescricoes, svc.minQuantidade, filters);
        results.push({
          serviceQuery: svc.query,
          resolvedDescricoes: svc.resolvedDescricoes,
          qualifyingAtestados: cumul.atestados,
          totalQuantidade: cumul.totalQuantidade,
          covered: cumul.meetsMinimum,
        });
      } else {
        const atestados = await this.findAtestadosComServico(svc.resolvedDescricoes, filters);
        results.push({
          serviceQuery: svc.query,
          resolvedDescricoes: svc.resolvedDescricoes,
          qualifyingAtestados: atestados,
          covered: atestados.length > 0,
        });
      }
    }
    return results;
  }

  async getAtestadoDetails(atestadoId: string): Promise<AtestadoDetailsRow | null> {
    const rows = await this.dataSource.query<AtestadoDetailsRow[]>(
      `SELECT
         a.id,
         a.original_filename AS filename,
         a.status,
         a.created_at::text AS "createdAt",
         MAX(o.nome) AS "obraNome",
         MAX(o.local) AS local,
         MAX(o.tipo) AS tipo,
         MIN(o.data_inicio::text) AS "dataInicio",
         MAX(o.data_fim::text) AS "dataFim",
         MAX(o.valor::text) AS valor,
         (SELECT c.numero FROM contratos c
          INNER JOIN obras o2 ON o2.id = c.obra_id
          WHERE o2.atestado_id = a.id LIMIT 1) AS "contratoNumero",
         COUNT(DISTINCT s.id)::text AS "totalServicos"
       FROM atestados a
       LEFT JOIN obras o ON o.atestado_id = a.id
       LEFT JOIN servicos_executados s ON s.atestado_id = a.id
       WHERE a.id = $1
       GROUP BY a.id, a.original_filename, a.status, a.created_at`,
      [atestadoId],
    );
    return rows[0] ?? null;
  }

  private buildFilterClauses(filters: QualificationFilters | undefined, params: unknown[]): string[] {
    if (!filters) return [];
    const clauses: string[] = [];
    if (filters.dataInicio) {
      params.push(filters.dataInicio);
      clauses.push(`o.data_inicio >= $${params.length}`);
    }
    if (filters.dataFim) {
      params.push(filters.dataFim);
      clauses.push(`o.data_fim <= $${params.length}`);
    }
    if (filters.localidade) {
      params.push(`%${filters.localidade}%`);
      clauses.push(`UPPER(o.local) LIKE UPPER($${params.length})`);
    }
    if (filters.minValor !== undefined) {
      params.push(filters.minValor);
      clauses.push(`o.valor >= $${params.length}`);
    }
    return clauses;
  }

  private mapRows(rows: QualificationSourceRow[]): QualificationSource[] {
    return rows.map((r) => ({
      atestadoId: r.atestadoId,
      filename: r.filename,
      obraNome: r.obraNome ?? '',
      local: r.local ?? undefined,
      dataInicio: r.dataInicio ?? undefined,
      dataFim: r.dataFim ?? undefined,
      valor: r.valor != null ? parseFloat(String(r.valor)) : undefined,
      contratoNumero: r.contratoNumero ?? undefined,
    }));
  }

  private async fetchServicosParaAtestados(
    atestadoIds: string[],
    descricoes: string[],
  ): Promise<Map<string, ServicoBuscado[]>> {
    if (atestadoIds.length === 0 || descricoes.length === 0) return new Map();
    const params: unknown[] = [atestadoIds];
    const ilikeConds = descricoes.map((d) => {
      params.push(`%${d}%`);
      return `UPPER(s.descricao) LIKE UPPER($${params.length})`;
    });
    const rows = await this.dataSource.query<{
      atestadoId: string;
      descricao: string;
      quantidade: string | null;
      unidade: string | null;
    }[]>(
      `SELECT s.atestado_id AS "atestadoId", s.descricao, s.quantidade, s.unidade
       FROM servicos_executados s
       WHERE s.atestado_id = ANY($1)
         AND (${ilikeConds.join(' OR ')})
       ORDER BY s.atestado_id, s.descricao`,
      params,
    );
    const map = new Map<string, ServicoBuscado[]>();
    for (const r of rows) {
      if (!map.has(r.atestadoId)) map.set(r.atestadoId, []);
      map.get(r.atestadoId)!.push({
        descricao: r.descricao,
        quantidade: r.quantidade != null ? parseFloat(r.quantidade) : undefined,
        unidade: r.unidade ?? undefined,
      });
    }
    return map;
  }
}
