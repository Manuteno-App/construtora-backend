import { Injectable } from '@nestjs/common';
import { ObraRepository } from '../../persistence/repository/obra.repository';
import { EmpresaRepository } from '../../persistence/repository/empresa.repository';
import { ContratoRepository } from '../../persistence/repository/contrato.repository';
import { ServicoExecutadoRepository } from '../../persistence/repository/servico-executado.repository';
import { EmpresaTipo } from '../../persistence/entity/empresa.entity';
import type { ServicoItem } from '../../../ingestion/core/service/table-extractor.service';

export interface ExtractedEntities {
  obra?: {
    nome: string;
    local?: string;
    tipo?: string;
    dataInicio?: string;
    dataFim?: string;
    valor?: number;
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
        tipo: entities.obra.tipo,
        dataInicio: entities.obra.dataInicio ? new Date(entities.obra.dataInicio) : undefined,
        dataFim: entities.obra.dataFim ? new Date(entities.obra.dataFim) : undefined,
        valor: entities.obra.valor,
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
              data: entities.contrato.data ? new Date(entities.contrato.data) : undefined,
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
