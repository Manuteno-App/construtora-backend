import { Obra } from '../../persistence/entity/obra.entity';
import { ServicoExecutado } from '../../persistence/entity/servico-executado.entity';
import {
  QuantitativoRow,
  QuantitativoFilters,
} from '../../persistence/repository/servico-executado.repository';

export interface IExtractionApi {
  getEntidadesByAtestadoId(atestadoId: string): Promise<Obra[]>;
  getServicosByAtestadoId(atestadoId: string, categoria?: string): Promise<ServicoExecutado[]>;
  getQuantitativos(filters: QuantitativoFilters): Promise<QuantitativoRow[]>;
  getQuantitativosAsMarkdown(filters: QuantitativoFilters): Promise<string>;
}

export const EXTRACTION_API = Symbol('IExtractionApi');
