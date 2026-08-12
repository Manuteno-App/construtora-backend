import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Response } from 'express';
import { CapabilityChatService } from '../../../core/service/capability-chat.service';
import { ConversationTurnRepository } from '../../../persistence/repository/conversation-turn.repository';

class ClarificationDto {
  @IsString() turnId!: string;
  @IsString() value!: string;
}

class CapabilityQueryDto {
  @IsString() query!: string;
  @IsOptional() @IsString() sessionId?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ClarificationDto)
  clarification?: ClarificationDto;
}

@ApiTags('intelligence')
@Controller('intelligence')
export class IntelligenceController {
  constructor(
    private readonly capabilityChat: CapabilityChatService,
    private readonly turnRepo: ConversationTurnRepository,
  ) {}

  @Post('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consulta estruturada de capacidade técnica com streaming SSE' })
  @ApiBody({ type: CapabilityQueryDto })
  async query(@Body() dto: CapabilityQueryDto, @Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const emit = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    try {
      emit({ type: 'status', content: 'Interpretando os requisitos técnicos…' });
      const output = await this.capabilityChat.answer(dto);
      if ('clarification' in output) {
        emit({ type: 'clarification', ...output.clarification, plan: output.plan });
      } else {
        emit({ type: 'answer', content: output.answer, result: output.result, plan: output.plan });
        emit({ type: 'sources', sources: output.sources });
      }
      emit({ type: 'done' });
    } catch {
      emit({ type: 'error', message: 'Não foi possível concluir a análise.' });
      emit({ type: 'done' });
    } finally {
      res.end();
    }
  }

  @Get('history/:sessionId')
  @ApiOperation({ summary: 'Histórico de uma conversa de capacidade técnica' })
  getHistory(@Param('sessionId') sessionId: string) {
    return this.turnRepo.findBySessionIdOrdered(sessionId);
  }
}
