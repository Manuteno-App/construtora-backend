import { Injectable } from '@nestjs/common';
import type { ServicoItem } from '../../../ingestion/core/service/table-extractor.service';
import { MeasurementsService } from '../../../measurements/core/service/measurements.service';
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
    private readonly measurements: MeasurementsService,
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

    if (entities.obra?.nome) {
      const obra = await this.obraRepo.upsertByAtestadoId({
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
            await this.contratoRepo.upsertByObraAndEmpresa({
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
      const resolvedRows = await Promise.all(
        tabelaServicos.map(async (s) => {
          const resolvedUnit = await this.measurements.resolveUnit(s.unidade, s.descricao);
          return {
            atestadoId,
            obraId: savedObraId,
            trecho: s.trecho,
            categoria: s.categoria,
            codigo: s.codigo,
            descricao: s.descricao,
            unidade: resolvedUnit.canonicalSymbol ?? s.unidade,
            unitId: resolvedUnit.unitId,
            unitSymbolRaw: s.unidade,
            normalizedServiceKey: this.measurements.normalizeServiceKey(s.descricao),
            quantidade: s.quantidade,
          };
        }),
      );

      await this.servicoRepo.upsertMany(
        resolvedRows,
      );

      await Promise.all(
        resolvedRows.map((row) =>
          this.measurements.recordServiceObservation({
            atestadoId,
            serviceDescription: row.descricao,
            unitId: row.unitId,
            quantity: row.quantidade,
            rawUnitSymbol: row.unitSymbolRaw,
          }),
        ),
      );
    }

    return { obraId: savedObraId };
  }
}
