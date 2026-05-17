import { Injectable } from '@nestjs/common';
import type { ServicoItem } from '../../../ingestion/core/service/table-extractor.service';
import { EmpresaTipo } from '../../persistence/entity/empresa.entity';
import { ContratoRepository } from '../../persistence/repository/contrato.repository';
import { EmpresaRepository } from '../../persistence/repository/empresa.repository';
import { ObraRepository } from '../../persistence/repository/obra.repository';
import { ServicoExecutadoRepository } from '../../persistence/repository/servico-executado.repository';

export interface ExtractedEntities {
  obra?: {
    nome: string;
    local?: string;
    cidade?: string;
    estado?: string;
    tipo?: string;
    dataInicio?: string;
    dataFim?: string;
    dataAtestado?: string;
    valor?: number;
    valorAtestado?: number;
    cliente?: string;
    engenheiro?: string;
    art?: string;
  };
  empresas?: Array<{ nome: string; cnpj?: string; tipo?: string }>;
  contrato?: { numero?: string; data?: string; valor?: number };
}

@Injectable()
export class EntityOrchestrationService {
  constructor(
    private readonly obraRepo: ObraRepository,
    private readonly empresaRepo: EmpresaRepository,
    private readonly contratoRepo: ContratoRepository,
    private readonly servicoRepo: ServicoExecutadoRepository,
  ) {}

  /** Safely parse a date string returned by the LLM.
   * Returns undefined for null literals, empty strings, and invalid dates. */
  private parseDate(val?: string): Date | undefined {
    if (!val || val === 'null' || val === 'undefined' || val.trim() === '') return undefined;
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d;
  }

  async persistExtractedEntities(
    entities: ExtractedEntities,
    atestadoId: string,
    tabelaServicos: ServicoItem[],
  ): Promise<{ obraId?: string }> {
    let savedObraId: string | undefined;

    if (entities.obra) {
      const obra = await this.obraRepo.createAndSave({
        atestadoId,
        nome: entities.obra.nome,
        local: entities.obra.local,
        cidade: entities.obra.cidade,
        estado: entities.obra.estado,
        tipo: entities.obra.tipo,
        dataInicio: this.parseDate(entities.obra.dataInicio),
        dataFim: this.parseDate(entities.obra.dataFim),
        dataAtestado: this.parseDate(entities.obra.dataAtestado),
        valor: entities.obra.valor,
        valorAtestado: entities.obra.valorAtestado,
        cliente: entities.obra.cliente,
        engenheiro: entities.obra.engenheiro,
        art: entities.obra.art,
      });
      savedObraId = obra.id;

      if (entities.empresas?.length) {
        for (const emp of entities.empresas) {
          const empresa = await this.empresaRepo.findOrCreate({
            nome: emp.nome,
            cnpj: emp.cnpj,
            tipo: (emp.tipo as EmpresaTipo) ?? undefined,
          });

          if (entities.contrato) {
            await this.contratoRepo.createAndSave({
              obraId: obra.id,
              empresaId: empresa.id,
              numero: entities.contrato.numero,
              data: this.parseDate(entities.contrato.data),
              valor: entities.contrato.valor,
            });
          }
        }
      }
    }

    if (tabelaServicos.length > 0) {
      await this.servicoRepo.upsertMany(
        tabelaServicos.map((s) => ({
          atestadoId,
          obraId: savedObraId,
          trecho: s.trecho,
          categoria: s.categoria,
          codigo: s.codigo,
          descricao: s.descricao,
          unidade: s.unidade,
          quantidade: s.quantidade,
        })),
      );
    }

    return { obraId: savedObraId };
  }
}
