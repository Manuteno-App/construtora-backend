import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Param,
    Post,
    Query,
    Res,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Response } from 'express';
import { EXTRACTION_API, IExtractionApi } from '../../../../extraction/public-api/interface/extraction-api.interface';
import { ReasoningEngineService } from '../../../core/service/reasoning-engine.service';
import { ConversationTurnRepository } from '../../../persistence/repository/conversation-turn.repository';

class PeriodoDto {
  @IsDateString() de!: string;
  @IsDateString() ate!: string;
}

class QueryFiltersDto {
  @IsOptional() @IsString() estado?: string;
  @IsOptional() @ValidateNested() @Type(() => PeriodoDto) periodo?: PeriodoDto;
  @IsOptional() @IsString() obraId?: string;
  @IsOptional() @IsString() empresaId?: string;
}

class QueryRequestDto {
  @IsString() query!: string;
  @IsOptional() @IsString() sessionId?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => QueryFiltersDto) filters?: QueryFiltersDto;
}

@ApiTags('intelligence')
@Controller('intelligence')
export class IntelligenceController {
  constructor(
    private readonly reasoningEngine: ReasoningEngineService,
    private readonly turnRepo: ConversationTurnRepository,
    @Inject(EXTRACTION_API) private readonly extractionApi: IExtractionApi,
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
  @ApiOperation({ summary: 'Consulta em linguagem natural — resposta completa' })
  @ApiBody({ type: QueryRequestDto })
  querySync(@Body() dto: QueryRequestDto) {
    return this.reasoningEngine.answer(dto);
  }

  @Get('history/:sessionId')
  @ApiOperation({ summary: 'Histórico de conversa de uma sessão' })
  getHistory(@Param('sessionId') sessionId: string) {
    return this.turnRepo.findBySessionIdOrdered(sessionId);
  }

  @Get('quantitativos')
  @ApiOperation({ summary: 'Agregações SQL de quantitativos executados' })
  @ApiQuery({ name: 'descricao', required: false, description: 'Comma-separated descriptions (OR/AND via operador)' })
  @ApiQuery({ name: 'categoria', required: false })
  @ApiQuery({ name: 'obraId', required: false })
  @ApiQuery({ name: 'localidade', required: false })
  @ApiQuery({ name: 'operador', required: false, enum: ['AND', 'OR'] })
  @ApiQuery({ name: 'minQuantidade', required: false })
  quantitativos(
    @Query('descricao') descricao?: string,
    @Query('categoria') categoria?: string,
    @Query('obraId') obraId?: string,
    @Query('localidade') localidade?: string,
    @Query('operador') operador?: string,
    @Query('minQuantidade') minQuantidade?: string,
  ) {
    const descricoes = descricao
      ? descricao.split(',').map((d) => d.trim()).filter(Boolean)
      : undefined;

    return this.extractionApi.getQuantitativos({
      descricao: descricoes?.length === 1 ? descricoes[0] : undefined,
      descricoes: descricoes && descricoes.length > 1 ? descricoes : undefined,
      operador: operador === 'AND' ? 'AND' : 'OR',
      categoria,
      obraId,
      localidade,
      minQuantidade: minQuantidade ? parseFloat(minQuantidade) : undefined,
    });
  }
}
