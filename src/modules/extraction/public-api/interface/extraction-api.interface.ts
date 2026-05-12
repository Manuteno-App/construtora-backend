import { Obra } from '../../persistence/entity/obra.entity';
import { ServicoExecutado } from '../../persistence/entity/servico-executado.entity';
import {
    QuantitativoFilters,
    QuantitativoRow,
    ServiceContextResult,
} from '../../persistence/repository/servico-executado.repository';

export interface AnalyticsHints {
  localidade?: string;
  categoria?: string;
}

export interface IExtractionApi {
  getEntidadesByAtestadoId(atestadoId: string): Promise<Obra[]>;
  getServicosByAtestadoId(atestadoId: string, categoria?: string): Promise<ServicoExecutado[]>;
  getQuantitativos(filters: QuantitativoFilters): Promise<QuantitativoRow[]>;
  getQuantitativosAsMarkdown(filters: QuantitativoFilters): Promise<string>;
  getAnalyticsAsMarkdown(hints?: AnalyticsHints): Promise<string>;
  searchServicosForContext(query: string): Promise<ServiceContextResult[]>;
  findAtestadosComTodosServicos(
    servicos: string[],
    minQuantidade?: number,
  ): Promise<{ atestadoId: string; filename: string }[]>;
}

export const EXTRACTION_API = Symbol('IExtractionApi');
