import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class UpsertServicoExecutadoDto {
  @IsOptional() @IsString() @MaxLength(255) categoria?: string;
  @IsOptional() @IsString() @MaxLength(255) codigo?: string;
  @IsString() descricao!: string;
  @IsOptional() @IsString() @MaxLength(255) unidade?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) quantidade?: number;
}
