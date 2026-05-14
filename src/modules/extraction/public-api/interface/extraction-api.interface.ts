import { Obra } from '../../persistence/entity/obra.entity';
import { ServicoExecutado } from '../../persistence/entity/servico-executado.entity';
import {
  ObraContextFilter,
  ObraContextRow,
} from '../../persistence/repository/obra.repository';
import {
  QuantitativoFilters,
  QuantitativoRow,
  ServiceContextResult,
} from '../../persistence/repository/servico-executado.repository';

export interface AnalyticsHints {
  localidade?: string;
  categoria?: string;
}

/** Per-service filter used in comprovação queries. */
export interface ServicoFilter {
  descricao: string;
  minQuantidade?: number;
}

export interface IExtractionApi {
  getEntidadesByAtestadoId(atestadoId: string): Promise<Obra[]>;
  getServicosByAtestadoId(atestadoId: string, categoria?: string): Promise<ServicoExecutado[]>;
  getQuantitativos(filters: QuantitativoFilters): Promise<QuantitativoRow[]>;
  getQuantitativosAsMarkdown(filters: QuantitativoFilters): Promise<string>;
  getAnalyticsAsMarkdown(hints?: AnalyticsHints): Promise<string>;
  searchServicosForContext(query: string): Promise<ServiceContextResult[]>;
  findObrasForContext(filter: ObraContextFilter): Promise<ObraContextRow[]>;
  /** Legacy single-minQuantidade overload kept for backward compat. */
  findAtestadosComTodosServicos(
    servicos: string[],
    minQuantidade?: number,
  ): Promise<{ atestadoId: string; filename: string }[]>;
  /** Per-service minQuantidade overload for comprovação queries. */
  findAtestadosComServicosFilter(
    servicos: ServicoFilter[],
  ): Promise<{ atestadoId: string; filename: string }[]>;
}

export const EXTRACTION_API = Symbol('IExtractionApi');
