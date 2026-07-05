import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateIf, ValidateNested } from 'class-validator';

export class QualificationFiltersDto {
  @IsOptional() @IsString() dataInicio?: string;
  @IsOptional() @IsString() dataFim?: string;
  @IsOptional() @IsString() localidade?: string;
  @IsOptional() @IsNumber() @Min(0) minValor?: number;
}

export class ServiceRequirementDto {
  @IsString() query!: string;
  @IsOptional() @IsNumber() @Min(0) minQuantidade?: number;
  @IsOptional() @IsString() unidade?: string;
  @IsOptional() @IsIn(['ONE', 'MANY', 'MAX']) proofMode?: 'ONE' | 'MANY' | 'MAX';
  @ValidateIf((o: ServiceRequirementDto) => o.proofMode === 'MAX')
  @IsNumber()
  @Min(1)
  maxAtestados?: number;
}

export class FindWithServiceDto {
  @IsArray()
  @IsString({ each: true })
  descricoes!: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QualificationFiltersDto)
  filters?: QualificationFiltersDto;
}

export class FindWithMinQuantityDto {
  @IsArray()
  @IsString({ each: true })
  descricoes!: string[];

  @IsNumber()
  @Min(0)
  minQuantidade!: number;

  @IsOptional()
  @IsString()
  unidade?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => QualificationFiltersDto)
  filters?: QualificationFiltersDto;
}

export class FindBundleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceRequirementDto)
  services!: ServiceRequirementDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QualificationFiltersDto)
  filters?: QualificationFiltersDto;
}

export class EvaluateBundleDto extends FindBundleDto {
  @IsIn(['ONE', 'MANY', 'MAX'])
  bundleMode!: 'ONE' | 'MANY' | 'MAX';

  @ValidateIf((o: EvaluateBundleDto) => o.bundleMode === 'MAX')
  @IsNumber()
  @Min(1)
  maxAtestados?: number;
}
