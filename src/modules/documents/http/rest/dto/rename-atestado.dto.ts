import { IsString, MaxLength } from 'class-validator';

export class RenameAtestadoDto {
  @IsString()
  @MaxLength(255)
  originalFilename!: string;
}
