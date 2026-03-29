import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBody, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReasoningEngineService } from './services/reasoning-engine.service';
import { QuantitativoQueryService } from './services/quantitativo-query.service';
import { ConversationTurn } from '../database/entities/conversation-turn.entity';

class PeriodoDto {
  @IsDateString()
  de!: string;

  @IsDateString()
  ate!: string;
}

class QueryFiltersDto {
  @IsOptional() @IsString() estado?: string;
  @IsOptional() @ValidateNested() @Type(() => PeriodoDto) periodo?: PeriodoDto;
  @IsOptional() @IsString() obraId?: string;
  @IsOptional() @IsString() empresaId?: string;
}

class QueryRequestDto {
  @IsString()
  query!: string;

  @IsOptional() @IsString()
  sessionId?: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => QueryFiltersDto)
  filters?: QueryFiltersDto;
}

@ApiTags('intelligence')
@Controller('intelligence')
export class IntelligenceController {
  constructor(
    private readonly reasoningEngine: ReasoningEngineService,
    private readonly quantitativoService: QuantitativoQueryService,
    @InjectRepository(ConversationTurn)
    private readonly turnRepo: Repository<ConversationTurn>,
  ) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consulta em linguagem natural com streaming SSE' })
  @ApiBody({ type: QueryRequestDto })
  async query(@Body() dto: QueryRequestDto, @Res() res: Response) {
    await this.reasoningEngine.streamAnswer(dto, res);
  }

  @Post('query/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consulta em linguagem natural — resposta completa (sem stream)' })
  @ApiBody({ type: QueryRequestDto })
  async querySync(@Body() dto: QueryRequestDto) {
    return this.reasoningEngine.answer(dto);
  }

  @Get('history/:sessionId')
  @ApiOperation({ summary: 'Histórico de conversa de uma sessão' })
  async getHistory(@Param('sessionId') sessionId: string) {
    return this.turnRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  @Get('quantitativos')
  @ApiOperation({ summary: 'Agregações SQL diretas de quantitativos executados' })
  @ApiQuery({ name: 'descricao', required: false })
  @ApiQuery({ name: 'categoria', required: false })
  @ApiQuery({ name: 'obraId', required: false })
  @ApiQuery({ name: 'de', required: false })
  @ApiQuery({ name: 'ate', required: false })
  async quantitativos(
    @Query('descricao') descricao?: string,
    @Query('categoria') categoria?: string,
    @Query('obraId') obraId?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.quantitativoService.query({ descricao, categoria, obraId, de, ate });
  }
}
