import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { QualificationService } from '../../../core/service/qualification.service';
import { EvaluateBundleDto, FindBundleDto, FindWithMinQuantityDto, FindWithServiceDto } from '../dto/qualification.dto';

@ApiTags('qualification')
@Controller('qualification')
export class QualificationController {
  constructor(private readonly qualificationService: QualificationService) {}

  @Get('resolve')
  @ApiOperation({ summary: 'Resolve service descriptions via FTS + ILIKE (autocomplete)' })
  @ApiQuery({ name: 'q', required: true, description: 'Query string' })
  resolveDescricoes(@Query('q') query: string) {
    return this.qualificationService.resolveDescricoes(query ?? '');
  }

  @Post('find-with-service')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'F1 — Atestados que possuem o serviço descrito' })
  findWithService(@Body() dto: FindWithServiceDto) {
    return this.qualificationService.findAtestadosComServico(dto.descricoes, dto.filters);
  }

  @Post('find-with-min-quantity')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'F2 — Atestados com quantidade mínima do serviço em um único atestado' })
  findWithMinQuantity(@Body() dto: FindWithMinQuantityDto) {
    return this.qualificationService.findAtestadosComQuantidadeMinima(
      dto.descricoes,
      dto.minQuantidade,
      dto.unidade,
      dto.filters,
    );
  }

  @Post('find-cumulative')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'F3 — Somatório de atestados para atingir quantidade mínima (acervo cumulativo)' })
  findCumulative(@Body() dto: FindWithMinQuantityDto) {
    return this.qualificationService.findCumulativoAtestados(dto.descricoes, dto.minQuantidade, dto.unidade, dto.filters);
  }

  @Post('find-bundle-single')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'F4 — Conjunto mínimo de atestados (greedy set cover) cobrindo todos os serviços individualmente',
  })
  findBundleSingle(@Body() dto: FindBundleDto) {
    return this.qualificationService.findBundleSingleCoverage(dto.services, dto.filters);
  }

  @Post('find-bundle-cumulative')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'F5 — Somatório de atestados para cada serviço do bundle' })
  findBundleCumulative(@Body() dto: FindBundleDto) {
    return this.qualificationService.findBundleCumulativeCoverage(dto.services, dto.filters);
  }

  @Post('evaluate-bundle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Avalia bundle de critérios com política explícita de comprovação' })
  evaluateBundle(@Body() dto: EvaluateBundleDto) {
    return this.qualificationService.evaluateBundlePolicy(dto);
  }
}
