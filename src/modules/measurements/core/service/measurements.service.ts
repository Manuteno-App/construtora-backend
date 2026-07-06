import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { QueryFailedError } from 'typeorm';
import { NotFoundDomainException } from '../../../../common/exception/not-found-domain.exception';
import {
  TechnicalUnitConversion,
  TechnicalUnitConversionStatus,
} from '../../persistence/entity/technical-unit-conversion.entity';
import { UnitFamily } from '../../persistence/entity/unit-family.entity';
import { RuleOrigin, UnitConversion, UnitConversionType } from '../../persistence/entity/unit-conversion.entity';
import { Unit, UnitOrigin, UnitStatus } from '../../persistence/entity/unit.entity';
import { ServiceUnitObservationRepository } from '../../persistence/repository/service-unit-observation.repository';
import { TechnicalUnitConversionRepository } from '../../persistence/repository/technical-unit-conversion.repository';
import { UnitConversionRepository } from '../../persistence/repository/unit-conversion.repository';
import { UnitFamilyRepository } from '../../persistence/repository/unit-family.repository';
import { UnitRepository } from '../../persistence/repository/unit.repository';
import {
  ConvertedQuantityResult,
  IMeasurementsApi,
  MeasurementUnitConversionPayload,
  MeasurementUnitPayload,
  TechnicalConversionPayload,
  TechnicalUnitConversionView,
  UnitResolutionResult,
} from '../../public-api/interface/measurements-api.interface';
import { UnitNormalizationService } from './unit-normalization.service';

interface AiUnitClassification {
  familySlug?: string;
  familyName?: string;
  confidence?: number;
  aliases?: string[];
}

@Injectable()
export class MeasurementsService implements IMeasurementsApi {
  private readonly logger = new Logger(MeasurementsService.name);
  private readonly openai?: OpenAI;
  private readonly extractionModel?: string;

  constructor(
    config: ConfigService,
    private readonly families: UnitFamilyRepository,
    private readonly units: UnitRepository,
    private readonly conversions: UnitConversionRepository,
    private readonly technicalConversions: TechnicalUnitConversionRepository,
    private readonly observations: ServiceUnitObservationRepository,
    private readonly normalization: UnitNormalizationService,
  ) {
    const apiKey = config.get<string>('openaiApiKey');
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.extractionModel = config.get<string>('extractionModel') ?? 'gpt-4o-mini';
    }
  }

  normalizeServiceKey(value: string): string {
    return this.normalization.normalizeServiceKey(value);
  }

  async resolveUnit(rawSymbol?: string, serviceDescription?: string): Promise<UnitResolutionResult> {
    const normalizedSymbol = this.normalization.normalize(rawSymbol);
    if (!normalizedSymbol) {
      return {
        unitSymbolRaw: rawSymbol ?? undefined,
        normalizedSymbol,
        needsReview: false,
      };
    }

    const existing = await this.units.findByNormalizedOrAlias(normalizedSymbol);
    if (existing) {
      const family = existing.family ?? (await this.families.findById(existing.familyId));
      return {
        unitId: existing.id,
        canonicalSymbol: existing.canonicalSymbol,
        familyId: existing.familyId,
        familyName: family?.name,
        unitSymbolRaw: rawSymbol ?? undefined,
        normalizedSymbol,
        needsReview: false,
      };
    }

    const classification = await this.classifyUnitWithAi(rawSymbol ?? normalizedSymbol, serviceDescription);
    const family = classification?.familySlug
      ? await this.families.findBySlug(classification.familySlug)
      : null;

    if (!family) {
      return {
        unitSymbolRaw: rawSymbol ?? undefined,
        normalizedSymbol,
        needsReview: true,
      };
    }

    const unit = await this.createOrUpdateUnit({
      name: this.normalization.canonicalize(normalizedSymbol),
      canonicalSymbol: this.normalization.canonicalize(normalizedSymbol),
      aliases: [...new Set([normalizedSymbol, ...(classification?.aliases ?? [])].filter(Boolean))],
      familyId: family.id,
      origin: UnitOrigin.AI,
      status: UnitStatus.ACTIVE,
    });

    await this.ensureKnownMathematicalConversions(unit, family);

    return {
      unitId: unit.id,
      canonicalSymbol: unit.canonicalSymbol,
      familyId: family.id,
      familyName: family.name,
      unitSymbolRaw: rawSymbol ?? undefined,
      normalizedSymbol,
      needsReview: (classification?.confidence ?? 0) < 0.7,
    };
  }

  async convertQuantity(params: {
    quantity: number;
    sourceUnitId?: string;
    targetUnitSymbol?: string;
    normalizedServiceKey?: string;
    serviceDescription?: string;
  }): Promise<ConvertedQuantityResult> {
    if (!params.sourceUnitId || !params.targetUnitSymbol) {
      return { success: false };
    }

    const targetNormalized = this.normalization.normalize(params.targetUnitSymbol);
    const targetUnit = await this.units.findByNormalizedOrAlias(targetNormalized);
    if (!targetUnit) {
      return { success: false };
    }

    if (params.sourceUnitId === targetUnit.id) {
      return {
        success: true,
        convertedQuantity: params.quantity,
        targetUnitId: targetUnit.id,
        targetUnitSymbol: targetUnit.canonicalSymbol,
        conversionKind: 'DIRECT',
        conversionFactor: 1,
      };
    }

    const math = await this.conversions.findByPair(params.sourceUnitId, targetUnit.id);
    if (math?.isActive) {
      return {
        success: true,
        convertedQuantity: params.quantity * Number(math.factor),
        targetUnitId: targetUnit.id,
        targetUnitSymbol: targetUnit.canonicalSymbol,
        conversionKind: 'MATHEMATICAL',
        conversionFactor: Number(math.factor),
      };
    }

    const normalizedServiceKey = params.normalizedServiceKey
      ?? (params.serviceDescription ? this.normalizeServiceKey(params.serviceDescription) : undefined);
    if (!normalizedServiceKey) {
      return { success: false };
    }

    const technical = await this.technicalConversions.findApprovedByKeyAndPair(
      normalizedServiceKey,
      params.sourceUnitId,
      targetUnit.id,
    );
    if (technical) {
      return {
        success: true,
        convertedQuantity: params.quantity * Number(technical.factor),
        targetUnitId: targetUnit.id,
        targetUnitSymbol: targetUnit.canonicalSymbol,
        conversionKind: 'TECHNICAL',
        conversionFactor: Number(technical.factor),
      };
    }

    return { success: false };
  }

  listFamilies(): Promise<UnitFamily[]> {
    return this.families.findAll();
  }

  listUnits(filters?: { search?: string; familyId?: string; status?: UnitStatus; origin?: UnitOrigin }): Promise<Unit[]> {
    return this.units.list(filters ?? {});
  }

  listConversions(): Promise<UnitConversion[]> {
    return this.conversions.findAll();
  }

  async listTechnicalConversions(status?: TechnicalUnitConversionStatus): Promise<TechnicalUnitConversionView[]> {
    const items = await this.technicalConversions.list(status);
    return items.map((item) => this.toTechnicalConversionView(item));
  }

  async createOrUpdateUnit(payload: MeasurementUnitPayload, id?: string): Promise<Unit> {
    const normalizedSymbol = this.normalization.normalize(payload.canonicalSymbol);
    const canonicalSymbol = this.normalization.canonicalize(normalizedSymbol);
    const aliases = [...new Set((payload.aliases ?? []).map((alias) => this.normalization.normalize(alias)).filter(Boolean))];
    const base: Partial<Unit> = {
      name: payload.name,
      canonicalSymbol,
      normalizedSymbol,
      aliasesJson: JSON.stringify(aliases),
      familyId: payload.familyId,
      status: payload.status ?? UnitStatus.ACTIVE,
      origin: payload.origin ?? UnitOrigin.USER,
    };

    if (id) {
      return (await this.units.updateEntity(id, base)) as Unit;
    }

    const existing = (await this.units.findByCanonicalSymbol(canonicalSymbol))
      ?? (await this.units.findByNormalizedOrAlias(normalizedSymbol));
    if (existing) {
      return existing;
    }

    try {
      return await this.units.saveEntity(this.units.createEntity(base));
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const conflicted = (await this.units.findByCanonicalSymbol(canonicalSymbol))
          ?? (await this.units.findByNormalizedOrAlias(normalizedSymbol));
        if (conflicted) return conflicted;
      }
      throw error;
    }
  }

  async createOrUpdateMathematicalConversion(
    payload: MeasurementUnitConversionPayload,
    id?: string,
  ): Promise<UnitConversion> {
    const sourceUnit = await this.units.findById(payload.sourceUnitId);
    const targetUnit = await this.units.findById(payload.targetUnitId);
    if (!sourceUnit || !targetUnit) throw new Error('Unidade origem/destino não encontrada');
    if (sourceUnit.familyId !== targetUnit.familyId) {
      throw new Error('Conversões matemáticas só podem existir entre unidades da mesma família');
    }

    const base: Partial<UnitConversion> = {
      sourceUnitId: payload.sourceUnitId,
      targetUnitId: payload.targetUnitId,
      factor: payload.factor,
      type: UnitConversionType.MATHEMATICAL,
      ruleOrigin: payload.ruleOrigin ?? RuleOrigin.USER,
      isActive: payload.isActive ?? true,
    };

    if (id) {
      return (await this.conversions.updateEntity(id, base)) as UnitConversion;
    }

    return this.conversions.saveEntity(this.conversions.createEntity(base));
  }

  async createOrUpdateTechnicalConversion(
    payload: TechnicalConversionPayload,
    id?: string,
  ): Promise<TechnicalUnitConversionView> {
    const normalizedServiceKey = payload.normalizedServiceKey ?? this.normalizeServiceKey(payload.serviceDescription);
    const base: Partial<TechnicalUnitConversion> = {
      serviceDescription: payload.serviceDescription,
      normalizedServiceKey,
      sourceUnitId: payload.sourceUnitId,
      targetUnitId: payload.targetUnitId,
      factor: payload.factor,
      ruleOrigin: payload.ruleOrigin ?? RuleOrigin.USER,
      status: payload.status ?? TechnicalUnitConversionStatus.PENDING,
      evidenceJson: JSON.stringify(payload.evidence ?? {}),
    };

    const existing = await this.technicalConversions.findExisting(
      normalizedServiceKey,
      payload.sourceUnitId,
      payload.targetUnitId,
    );

    if (id) {
      if (existing && existing.id !== id) {
        throw new ConflictException('Já existe uma conversão técnica para este serviço e par de unidades');
      }

      const updated = await this.technicalConversions.updateEntity(id, base);
      if (!updated) throw new NotFoundDomainException('TechnicalUnitConversion', id);
      return this.toTechnicalConversionView(updated);
    }

    if (existing) {
      const updated = await this.technicalConversions.updateEntity(existing.id, base);
      if (!updated) throw new NotFoundDomainException('TechnicalUnitConversion', existing.id);
      return this.toTechnicalConversionView(updated);
    }

    try {
      const created = await this.technicalConversions.saveEntity(
        this.technicalConversions.createEntity(base),
      );
      return this.toTechnicalConversionView(created);
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;

      const concurrent = await this.technicalConversions.findExisting(
        normalizedServiceKey,
        payload.sourceUnitId,
        payload.targetUnitId,
      );
      if (!concurrent) throw error;

      const updated = await this.technicalConversions.updateEntity(concurrent.id, base);
      if (!updated) throw new NotFoundDomainException('TechnicalUnitConversion', concurrent.id);
      return this.toTechnicalConversionView(updated);
    }
  }

  async updateTechnicalConversionStatus(
    id: string,
    status: TechnicalUnitConversionStatus,
  ): Promise<TechnicalUnitConversionView> {
    const updated = await this.technicalConversions.updateEntity(id, { status });
    if (!updated) throw new NotFoundDomainException('TechnicalUnitConversion', id);
    return this.toTechnicalConversionView(updated);
  }

  async recordServiceObservation(params: {
    atestadoId: string;
    servicoExecutadoId?: string;
    serviceDescription: string;
    unitId?: string;
    quantity?: number;
    rawUnitSymbol?: string;
  }): Promise<void> {
    if (!params.unitId) return;

    await this.observations.saveEntity(this.observations.createEntity({
      atestadoId: params.atestadoId,
      servicoExecutadoId: params.servicoExecutadoId,
      serviceDescription: params.serviceDescription,
      normalizedServiceKey: this.normalizeServiceKey(params.serviceDescription),
      unitId: params.unitId,
      quantidade: params.quantity,
      rawUnitSymbol: params.rawUnitSymbol,
      evidenceJson: JSON.stringify({ source: 'IMPORT' }),
    }));

    await this.suggestTechnicalConversionsForService(params.serviceDescription);
  }

  private async suggestTechnicalConversionsForService(serviceDescription: string): Promise<void> {
    const normalizedServiceKey = this.normalizeServiceKey(serviceDescription);
    const grouped = await this.observations.findGroupedCandidates(normalizedServiceKey);
    if (grouped.length !== 2) return;

    for (const source of grouped) {
      for (const target of grouped) {
        if (source.unitId === target.unitId) continue;
        const sourceSamples = Number(source.sampleCount);
        const targetSamples = Number(target.sampleCount);
        if (sourceSamples < 2 || targetSamples < 2) continue;
        if (source.familyId === target.familyId) continue;
        const sourceAvg = parseFloat(source.avgQuantity ?? '');
        const targetAvg = parseFloat(target.avgQuantity ?? '');
        if (!sourceAvg || !targetAvg) continue;
        const factor = sourceAvg / targetAvg;
        if (!Number.isFinite(factor) || factor <= 0 || factor < 0.01 || factor > 1000) continue;

        const existing = await this.technicalConversions.findExisting(
          normalizedServiceKey,
          source.unitId,
          target.unitId,
        );
        if (existing) continue;

        await this.createOrUpdateTechnicalConversion({
          serviceDescription,
          normalizedServiceKey,
          sourceUnitId: source.unitId,
          targetUnitId: target.unitId,
          factor,
          ruleOrigin: RuleOrigin.AI,
          status: TechnicalUnitConversionStatus.PENDING,
          evidence: {
            heuristic: 'two-unit-average-ratio',
            samples: [
              {
                unitId: source.unitId,
                unitSymbol: source.unitSymbol,
                familyId: source.familyId,
                familyName: source.familyName,
                sampleCount: sourceSamples,
                avgQuantity: sourceAvg,
              },
              {
                unitId: target.unitId,
                unitSymbol: target.unitSymbol,
                familyId: target.familyId,
                familyName: target.familyName,
                sampleCount: targetSamples,
                avgQuantity: targetAvg,
              },
            ],
          },
        });
      }
    }
  }

  private async classifyUnitWithAi(symbol: string, serviceDescription?: string): Promise<AiUnitClassification | null> {
    if (!this.openai || !this.extractionModel) return null;
    try {
      const families = await this.families.findAll();
      const prompt = `Classifique a unidade de medida abaixo em uma das famílias existentes.
Retorne JSON com: familySlug, familyName, confidence (0-1), aliases.
Se não souber, retorne confidence 0.

Famílias disponíveis:
${families.map((family) => `- ${family.slug}: ${family.name}`).join('\n')}

Unidade: ${symbol}
Contexto de serviço: ${serviceDescription ?? '-'}
`;
      const response = await this.openai.chat.completions.create({
        model: this.extractionModel,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 300,
      });
      return JSON.parse(response.choices[0]?.message?.content ?? '{}') as AiUnitClassification;
    } catch (error) {
      this.logger.warn(`Falha ao classificar unidade com IA: ${(error as Error).message}`);
      return null;
    }
  }

  private async ensureKnownMathematicalConversions(unit: Unit, family: UnitFamily): Promise<void> {
    const canonical = unit.canonicalSymbol;
    const knownFactors = this.getSeedFactorsForFamily(family.slug);
    const current = knownFactors[canonical];
    if (current == null) return;

    const familyUnits = (await this.units.list({ familyId: family.id, status: UnitStatus.ACTIVE }))
      .filter((item) => item.id !== unit.id);

    for (const otherUnit of familyUnits) {
      const otherFactor = knownFactors[otherUnit.canonicalSymbol];
      if (otherFactor == null) continue;
      await this.ensureConversionPair(unit.id, otherUnit.id, otherFactor / current);
      await this.ensureConversionPair(otherUnit.id, unit.id, current / otherFactor);
    }
  }

  private async ensureConversionPair(sourceUnitId: string, targetUnitId: string, factor: number): Promise<void> {
    const existing = await this.conversions.findByPair(sourceUnitId, targetUnitId);
    if (existing) return;
    await this.createOrUpdateMathematicalConversion({
      sourceUnitId,
      targetUnitId,
      factor,
      ruleOrigin: RuleOrigin.AI,
      isActive: true,
    });
  }

  private getSeedFactorsForFamily(familySlug: string): Record<string, number> {
    const byFamily: Record<string, Record<string, number>> = {
      comprimento: { mm: 0.001, cm: 0.01, m: 1, km: 1000 },
      area: { 'm²': 1, ha: 10000, 'km²': 1000000 },
      volume: { L: 0.001, 'm³': 1 },
      massa: { g: 0.001, kg: 1, t: 1000 },
    };
    return byFamily[familySlug] ?? {};
  }

  private safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof QueryFailedError
      && (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505';
  }

  private toTechnicalConversionView(item: TechnicalUnitConversion): TechnicalUnitConversionView {
    return {
      id: item.id,
      serviceDescription: item.serviceDescription,
      normalizedServiceKey: item.normalizedServiceKey,
      sourceUnitId: item.sourceUnitId,
      targetUnitId: item.targetUnitId,
      factor: Number(item.factor),
      ruleOrigin: item.ruleOrigin,
      status: item.status,
      evidence: this.safeJsonParse(item.evidenceJson, {}),
      sourceUnit: item.sourceUnit,
      targetUnit: item.targetUnit,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }
}
