import { TechnicalUnitConversionStatus } from '../../persistence/entity/technical-unit-conversion.entity';
import { UnitFamily, UnitFamilyStatus } from '../../persistence/entity/unit-family.entity';
import { RuleOrigin, UnitConversion } from '../../persistence/entity/unit-conversion.entity';
import { Unit, UnitOrigin, UnitStatus } from '../../persistence/entity/unit.entity';

export interface UnitResolutionResult {
  unitId?: string;
  canonicalSymbol?: string;
  familyId?: string;
  familyName?: string;
  unitSymbolRaw?: string;
  normalizedSymbol?: string;
  needsReview: boolean;
}

export interface ConvertedQuantityResult {
  success: boolean;
  convertedQuantity?: number;
  targetUnitId?: string;
  targetUnitSymbol?: string;
  conversionKind?: 'DIRECT' | 'MATHEMATICAL' | 'TECHNICAL';
  conversionFactor?: number;
}

export interface MeasurementUnitPayload {
  name: string;
  canonicalSymbol: string;
  aliases?: string[];
  familyId: string;
  status?: UnitStatus;
  origin?: UnitOrigin;
}

export interface MeasurementUnitConversionPayload {
  sourceUnitId: string;
  targetUnitId: string;
  factor: number;
  ruleOrigin?: RuleOrigin;
  isActive?: boolean;
}

export interface TechnicalConversionPayload {
  serviceDescription: string;
  normalizedServiceKey?: string;
  sourceUnitId: string;
  targetUnitId: string;
  factor: number;
  ruleOrigin?: RuleOrigin;
  status?: TechnicalUnitConversionStatus;
  evidence?: Record<string, unknown>;
}

export interface TechnicalUnitConversionView {
  id: string;
  serviceDescription: string;
  normalizedServiceKey: string;
  sourceUnitId: string;
  targetUnitId: string;
  factor: number;
  ruleOrigin: RuleOrigin;
  status: TechnicalUnitConversionStatus;
  evidence: Record<string, unknown>;
  sourceUnit?: Unit;
  targetUnit?: Unit;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IMeasurementsApi {
  resolveUnit(rawSymbol?: string, serviceDescription?: string): Promise<UnitResolutionResult>;
  convertQuantity(params: {
    quantity: number;
    sourceUnitId?: string;
    targetUnitSymbol?: string;
    normalizedServiceKey?: string;
    serviceDescription?: string;
  }): Promise<ConvertedQuantityResult>;
  normalizeServiceKey(value: string): string;
  listFamilies(): Promise<UnitFamily[]>;
  listUnits(filters?: { search?: string; familyId?: string; status?: UnitStatus; origin?: UnitOrigin }): Promise<Unit[]>;
  listConversions(): Promise<UnitConversion[]>;
  listTechnicalConversions(status?: TechnicalUnitConversionStatus): Promise<TechnicalUnitConversionView[]>;
  createOrUpdateUnit(payload: MeasurementUnitPayload, id?: string): Promise<Unit>;
  createOrUpdateMathematicalConversion(payload: MeasurementUnitConversionPayload, id?: string): Promise<UnitConversion>;
  createOrUpdateTechnicalConversion(payload: TechnicalConversionPayload, id?: string): Promise<TechnicalUnitConversionView>;
  updateTechnicalConversionStatus(id: string, status: TechnicalUnitConversionStatus): Promise<TechnicalUnitConversionView>;
}

export const MEASUREMENTS_API = Symbol('IMEASUREMENTS_API');

export {
  RuleOrigin,
  TechnicalUnitConversionStatus,
  UnitFamily,
  UnitFamilyStatus,
  Unit,
  UnitConversion,
  UnitOrigin,
  UnitStatus,
};
