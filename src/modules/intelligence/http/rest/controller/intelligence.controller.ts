import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  Inject,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBody, ApiQuery } from '@nestjs/swagger';
import { IsString, IsOptional, IsObject, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ReasoningEngineService } from '../../../core/service/reasoning-engine.service';
import { ConversationTurnRepository } from '../../../persistence/repository/conversation-turn.repository';
import { IExtractionApi, EXTRACTION_API } from '../../../../extraction/public-api/interface/extraction-api.interface';

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
  @ApiQuery({ name: 'descricao', required: false })
  @ApiQuery({ name: 'categoria', required: false })
  @ApiQuery({ name: 'obraId', required: false })
  quantitativos(
    @Query('descricao') descricao?: string,
    @Query('categoria') categoria?: string,
    @Query('obraId') obraId?: string,
  ) {
    return this.extractionApi.getQuantitativos({ descricao, categoria, obraId });
  }
}
