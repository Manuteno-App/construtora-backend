import { Obra } from '../../persistence/entity/obra.entity';
import { ServicoExecutado } from '../../persistence/entity/servico-executado.entity';
import {
  ObraContextFilter,
  ObraContextRow,
} from '../../persistence/repository/obra.repository';
import { QuantitativoFilters, QuantitativoRow } from '../../persistence/repository/servico-executado.repository';

export interface IExtractionApi {
  getEntidadesByAtestadoId(atestadoId: string): Promise<Obra[]>;
  getServicosByAtestadoId(atestadoId: string, categoria?: string): Promise<ServicoExecutado[]>;
  getQuantitativos(filters: QuantitativoFilters): Promise<QuantitativoRow[]>;
  findObrasForContext(filter: ObraContextFilter): Promise<ObraContextRow[]>;
}

export const EXTRACTION_API = Symbol('IExtractionApi');
