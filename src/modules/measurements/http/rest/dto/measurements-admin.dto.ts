import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { TechnicalUnitConversionStatus } from '../../../persistence/entity/technical-unit-conversion.entity';
import { RuleOrigin } from '../../../persistence/entity/unit-conversion.entity';
import { UnitOrigin, UnitStatus } from '../../../persistence/entity/unit.entity';

export class ListUnitsQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsUUID() familyId?: string;
  @IsOptional() @IsEnum(UnitStatus) status?: UnitStatus;
  @IsOptional() @IsEnum(UnitOrigin) origin?: UnitOrigin;
}

export class UpsertUnitDto {
  @IsString() name!: string;
  @IsString() canonicalSymbol!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) aliases?: string[];
  @IsUUID() familyId!: string;
  @IsOptional() @IsEnum(UnitStatus) status?: UnitStatus;
  @IsOptional() @IsEnum(UnitOrigin) origin?: UnitOrigin;
}

export class UpsertMathematicalConversionDto {
  @IsUUID() sourceUnitId!: string;
  @IsUUID() targetUnitId!: string;
  @Type(() => Number) @IsNumber() @Min(0) factor!: number;
  @IsOptional() @IsEnum(RuleOrigin) ruleOrigin?: RuleOrigin;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ListTechnicalConversionsQueryDto {
  @IsOptional() @IsEnum(TechnicalUnitConversionStatus) status?: TechnicalUnitConversionStatus;
}

export class UpsertTechnicalConversionDto {
  @IsString() serviceDescription!: string;
  @IsOptional() @IsString() normalizedServiceKey?: string;
  @IsUUID() sourceUnitId!: string;
  @IsUUID() targetUnitId!: string;
  @Type(() => Number) @IsNumber() @Min(0) factor!: number;
  @IsOptional() @IsEnum(RuleOrigin) ruleOrigin?: RuleOrigin;
  @IsOptional() @IsEnum(TechnicalUnitConversionStatus) status?: TechnicalUnitConversionStatus;
  @IsOptional() @IsObject() evidence?: Record<string, unknown>;
}

export class UpdateTechnicalConversionStatusDto {
  @IsEnum(TechnicalUnitConversionStatus)
  status!: TechnicalUnitConversionStatus;
}
