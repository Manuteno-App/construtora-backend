import { Injectable, Logger } from '@nestjs/common';
import type { ServicoItem } from '../../../ingestion/core/service/table-extractor.service';
import { MeasurementsService } from '../../../measurements/core/service/measurements.service';
import { parseNumeroBR } from '../../../../common/utils/numero-br.util';
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
  private readonly logger = new Logger(EntityOrchestrationService.name);

  constructor(
    private readonly obraRepo: ObraRepository,
    private readonly empresaRepo: EmpresaRepository,
    private readonly contratoRepo: ContratoRepository,
    private readonly servicoRepo: ServicoExecutadoRepository,
    private readonly measurements: MeasurementsService,
  ) {}

  private normalizeCategory(value?: string): string {
    const category = value?.trim().replace(/\s+/g, ' ') ?? '';
    if (!category || /^(?:null|undefined|0+|(?:sub)?total|soma)$/i.test(category) || /^[A-Z]{0,3}[-.]?\d+(?:[.-]\d+)*$/i.test(category)) {
      return 'SEM_CATEGORIA';
    }
    return category.replace(/^\d+(?:\.0)?\.?\s+/, '').trim() || 'SEM_CATEGORIA';
  }

  private normalizeKeyPart(value?: string): string {
    return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private rowScore(row: { baixaConfianca?: boolean; quantidade?: number; descricao?: string }): number {
    return (row.baixaConfianca ? 0 : 4) + (row.quantidade === undefined ? 0 : 2) + (row.descricao?.length ?? 0) / 1000;
  }

  /** Safely parse a date string returned by the LLM.
   * Returns undefined for null literals, empty strings, and invalid dates. */
  private parseDate(val?: string): Date | undefined {
    if (!val || val === 'null' || val === 'undefined' || val.trim() === '') return undefined;
    const br = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(val.trim());
    if (br) {
      // Date-only database fields must use local calendar components. Creating
      // midnight UTC serializes as the prior local day in America/Sao_Paulo.
      const d = new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
      return d.getFullYear() === Number(br[3]) && d.getMonth() === Number(br[2]) - 1 && d.getDate() === Number(br[1])
        ? d
        : undefined;
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(val.trim());
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
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
        let contractEmpresaId: string | undefined;
        for (const emp of entities.empresas) {
          const empresa = await this.empresaRepo.findOrCreate({
            nome: emp.nome,
            cnpj: emp.cnpj,
            tipo: (emp.tipo as EmpresaTipo) ?? undefined,
          });
          // The contract belongs to the contractor. If it is absent, use the
          // only/first identified company rather than creating one contract per company.
          if (!contractEmpresaId || emp.tipo === EmpresaTipo.CONTRATADA) {
            contractEmpresaId = empresa.id;
          }
        }

        if (entities.contrato && contractEmpresaId) {
          await this.contratoRepo.upsertByObraAndEmpresa({
            obraId: obra.id,
            empresaId: contractEmpresaId,
            numero: entities.contrato.numero,
            data: this.parseDate(entities.contrato.data),
            valor: entities.contrato.valor,
          });
        }
      }
    }

    if (tabelaServicos.length > 0) {
      const resolutionCache = new Map<string, Awaited<ReturnType<MeasurementsService['resolveUnit']>>>();
      const rowsByKey = new Map<string, any>();
      let invalidQuantities = 0;
      let missingCategories = 0;
      let mergedDuplicates = 0;

      for (const service of tabelaServicos) {
        const rawQuantity = service.quantidadeRaw ?? (service.quantidade !== undefined ? String(service.quantidade) : undefined);
        const quantity = rawQuantity === undefined ? undefined : parseNumeroBR(rawQuantity);
        const category = this.normalizeCategory(service.categoria);
        const invalidQuantity = rawQuantity !== undefined && quantity === undefined;
        const baixaConfianca = Boolean(service.baixaConfianca) || invalidQuantity || category === 'SEM_CATEGORIA';
        if (invalidQuantity) invalidQuantities++;
        if (category === 'SEM_CATEGORIA') missingCategories++;

        const cacheKey = (service.unidade ?? '') + '::' + service.descricao;
        let resolvedUnit = resolutionCache.get(cacheKey);
        if (!resolvedUnit) {
          resolvedUnit = await this.measurements.resolveUnit(service.unidade, service.descricao);
          resolutionCache.set(cacheKey, resolvedUnit);
        }

        const normalizedCode = this.normalizeKeyPart(service.codigo);
        const unitKey = resolvedUnit.normalizedSymbol || this.normalizeKeyPart(service.unidade) || 'sem-unidade';
        const canonicalUnit = (resolvedUnit.canonicalSymbol ?? service.unidade)?.trim().toLowerCase();
        const fallbackKey = [category, this.measurements.normalizeServiceKey(service.descricao)]
          .map((part) => this.normalizeKeyPart(part))
          .filter(Boolean)
          .join('::');
        const scopeKey = this.normalizeKeyPart(service.sourceScope);
        const itemKey = [scopeKey, normalizedCode || fallbackKey, unitKey]
          .filter(Boolean)
          .join('::');
        const row = {
          atestadoId,
          obraId: savedObraId,
          categoria: category,
          codigo: service.codigo?.trim() || undefined,
          descricao: service.descricao.trim(),
          unidade: canonicalUnit,
          unitId: resolvedUnit.unitId,
          unitSymbolRaw: service.unidade,
          normalizedServiceKey: this.measurements.normalizeServiceKey(service.descricao),
          itemKey,
          quantidadeRaw: rawQuantity,
          quantidade: quantity,
          baixaConfianca,
          extractionMethod: service.metodoExtracao ?? 'NATIVE',
          extractionVersion: 'v2',
        };

        const existing = rowsByKey.get(itemKey);
        if (existing) {
          mergedDuplicates++;
          if (this.rowScore(row) > this.rowScore(existing)) rowsByKey.set(itemKey, row);
        } else {
          rowsByKey.set(itemKey, row);
        }
      }

      const resolvedRows = [...rowsByKey.values()];
      await this.servicoRepo.upsertMany(resolvedRows);
      await Promise.all(resolvedRows.map((row) => this.measurements.recordServiceObservation({
        atestadoId,
        serviceDescription: row.descricao,
        unitId: row.unitId,
        quantity: row.quantidade,
        rawUnitSymbol: row.unitSymbolRaw,
      })));

      this.logger.log('Services v2: extracted=' + tabelaServicos.length + ' persisted=' + resolvedRows.length + ' invalidQuantities=' + invalidQuantities + ' missingCategories=' + missingCategories + ' mergedDuplicates=' + mergedDuplicates);
    }

    return { obraId: savedObraId };
  }
}
