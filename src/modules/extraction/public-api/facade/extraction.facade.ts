import { Injectable } from '@nestjs/common';
import { IExtractionApi } from '../interface/extraction-api.interface';
import { ObraRepository } from '../../persistence/repository/obra.repository';
import { ServicoExecutadoRepository } from '../../persistence/repository/servico-executado.repository';
import type { Obra } from '../../persistence/entity/obra.entity';
import type { ServicoExecutado } from '../../persistence/entity/servico-executado.entity';
import type { QuantitativoRow, QuantitativoFilters } from '../../persistence/repository/servico-executado.repository';

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

    const header = '| Descrição | Unidade | Total |\n|---|---|---|';
    const body = rows
      .map((r) => `| ${r.descricao} | ${r.unidade ?? '-'} | ${r.total} |`)
      .join('\n');
    return `${header}\n${body}`;
  }
}
