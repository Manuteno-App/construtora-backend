import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class QualificationFiltersDto {
  @IsOptional() @IsString() dataInicio?: string;
  @IsOptional() @IsString() dataFim?: string;
  @IsOptional() @IsString() localidade?: string;
  @IsOptional() @IsNumber() @Min(0) minValor?: number;
}

export class ServiceRequirementDto {
  @IsString() query!: string;
  @IsOptional() @IsNumber() @Min(0) minQuantidade?: number;
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
