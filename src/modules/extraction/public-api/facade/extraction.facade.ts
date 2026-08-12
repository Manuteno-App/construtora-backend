import { Injectable } from '@nestjs/common';
import type { Obra } from '../../persistence/entity/obra.entity';
import type { ServicoExecutado } from '../../persistence/entity/servico-executado.entity';
import { ObraContextFilter, ObraContextRow, ObraRepository } from '../../persistence/repository/obra.repository';
import type { QuantitativoFilters, QuantitativoRow } from '../../persistence/repository/servico-executado.repository';
import { ServicoExecutadoRepository } from '../../persistence/repository/servico-executado.repository';
import { IExtractionApi } from '../interface/extraction-api.interface';

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

  findObrasForContext(filter: ObraContextFilter): Promise<ObraContextRow[]> {
    return this.obraRepo.findObrasForContext(filter);
  }

}
