import { Injectable } from '@nestjs/common';
import type { Obra } from '../../persistence/entity/obra.entity';
import type { ServicoExecutado } from '../../persistence/entity/servico-executado.entity';
import { ObraRepository } from '../../persistence/repository/obra.repository';
import type {
  QuantitativoFilters,
  QuantitativoRow,
  ServiceContextResult,
} from '../../persistence/repository/servico-executado.repository';
import { ServicoExecutadoRepository } from '../../persistence/repository/servico-executado.repository';
import { AnalyticsHints, IExtractionApi } from '../interface/extraction-api.interface';

@Injectable()
export class ExtractionFacade implements IExtractionApi {
  constructor(
    private readonly obraRepo: ObraRepository,
    private readonly servicoRepo: ServicoExecutadoRepository,
  ) {}

  getEntidadesByAtestadoId(atestadoId: string): Promise<Obra[]> {
    return this.obraRepo.findByAtestadoId(atestadoId);
  }

  getServicosByAtestadoId(atestadoId: string, categoria?: string): Promise<ServicoExecutado[]> {
    return this.servicoRepo.findByAtestadoId(atestadoId, categoria);
  }

  getQuantitativos(filters: QuantitativoFilters): Promise<QuantitativoRow[]> {
    return this.servicoRepo.aggregateQuantitativos(filters);
  }

  async getQuantitativosAsMarkdown(filters: QuantitativoFilters): Promise<string> {
    const rows = await this.servicoRepo.aggregateQuantitativos(filters);
    if (rows.length === 0) return '';

    const header = '| Descrição | Unidade | Total | Nº Atestados |\n|---|---|---|---|';
    const body = rows
      .map((r) => `| ${r.descricao} | ${r.unidade ?? '-'} | ${r.total} | ${r.atestados.length} |`)
      .join('\n');
    return `${header}\n${body}`;
  }

  async getAnalyticsAsMarkdown(hints?: AnalyticsHints): Promise<string> {
    const parts: string[] = [];

    // Top services filtered by hints when available
    const servicoFilters: QuantitativoFilters = {
      localidade: hints?.localidade,
      categoria: hints?.categoria,
    };
    const servicos = await this.servicoRepo.aggregateQuantitativos(servicoFilters);
    if (servicos.length > 0) {
      const top = servicos.slice(0, 15);
      const header = '**Top serviços executados (por quantidade acumulada):**\n| Descrição | Unidade | Total | Nº Atestados |\n|---|---|---|---|';
      const body = top
        .map((r) => `| ${r.descricao} | ${r.unidade ?? '-'} | ${r.total} | ${r.atestados.length} |`)
        .join('\n');
      parts.push(`${header}\n${body}`);
    }

    // Localidade aggregation when hint is provided
    if (hints?.localidade) {
      const localidades = await this.obraRepo.aggregateValoresByLocalidade(hints.localidade);
      if (localidades.length > 0) {
        const header = '**Obras por localidade:**\n| Local | Total de Obras | Soma de Valores (R$) | Nº Atestados |\n|---|---|---|---|';
        const body = localidades
          .map((l) => `| ${l.local ?? '-'} | ${l.totalObras} | ${l.somaValores != null ? l.somaValores.toFixed(2) : '-'} | ${l.atestados} |`)
          .join('\n');
        parts.push(`${header}\n${body}`);
      }
    }

    // Top companies by number of atestados
    const empresas = await this.obraRepo.aggregateEmpresas(15);
    if (empresas.length > 0) {
      const header = '**Empresas por número de atestados:**\n| Empresa | Tipo | Nº Atestados |\n|---|---|---|';
      const body = empresas
        .map((e) => `| ${e.nome} | ${e.tipo ?? '-'} | ${e.atestados} |`)
        .join('\n');
      parts.push(`${header}\n${body}`);
    }

    return parts.join('\n\n');
  }

  searchServicosForContext(query: string): Promise<ServiceContextResult[]> {
    return this.servicoRepo.searchForContext(query);
  }

  findAtestadosComTodosServicos(
    servicos: string[],
    minQuantidade?: number,
  ): Promise<{ atestadoId: string; filename: string }[]> {
    return this.servicoRepo.findAtestadosComTodosServicos(servicos, minQuantidade);
  }
}
