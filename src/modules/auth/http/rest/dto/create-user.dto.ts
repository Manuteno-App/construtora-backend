import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'usuario@construtora.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'João Silva' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 'senha123' })
  @IsString()
  @MinLength(8)
  password!: string;
}
