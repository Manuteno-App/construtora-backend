import { Body, Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IExtractionApi, EXTRACTION_API } from '../../../public-api/interface/extraction-api.interface';
import { MeasurementsService } from '../../../../measurements/core/service/measurements.service';
import { ServicoExecutadoRepository } from '../../../persistence/repository/servico-executado.repository';
import { UpsertServicoExecutadoDto } from '../dto/servico-executado.dto';
import { ServiceSemanticIndexService } from '../../../../qualification/core/service/service-semantic-index.service';
import { normalizeServiceSearchKey } from '../../../../../common/utils/service-search-key.util';

@ApiTags('extraction')
@Controller('extraction')
export class ExtractionController {
  constructor(@Inject(EXTRACTION_API) private readonly extractionApi: IExtractionApi) {}

  @Get(':atestadoId/entities')
  @ApiOperation({ summary: 'Entidades extraídas (obra, empresa, contrato)' })
  getEntities(@Param('atestadoId', ParseUUIDPipe) atestadoId: string) {
    return this.extractionApi.getEntidadesByAtestadoId(atestadoId);
  }

  @Get(':atestadoId/servicos')
  @ApiOperation({ summary: 'Serviços executados de um atestado' })
  @ApiQuery({ name: 'categoria', required: false })
  getServicos(@Param('atestadoId', ParseUUIDPipe) atestadoId: string, @Query('categoria') categoria?: string) {
    return this.extractionApi.getServicosByAtestadoId(atestadoId, categoria);
  }
}

@ApiTags('atestados')
@Controller('atestados')
export class AtestadoServicosController {
  constructor(
    @Inject(EXTRACTION_API) private readonly extractionApi: IExtractionApi,
    private readonly servicos: ServicoExecutadoRepository,
    private readonly measurements: MeasurementsService,
    private readonly semanticIndex: ServiceSemanticIndexService,
  ) {}

  @Get(':id/servicos')
  @ApiOperation({ summary: 'Tabela de serviços executados de um atestado' })
  @ApiQuery({ name: 'categoria', required: false })
  findServicos(@Param('id', ParseUUIDPipe) id: string, @Query('categoria') categoria?: string) {
    return this.extractionApi.getServicosByAtestadoId(id, categoria);
  }

  @Post(':id/servicos')
  @ApiOperation({ summary: 'Adiciona uma linha de serviço manual' })
  async createServico(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpsertServicoExecutadoDto) {
    const service = await this.servicos.createManual(id, await this.prepare(body));
    await this.semanticIndex.indexService(service.id);
    return service;
  }

  @Patch(':id/servicos/:servicoId')
  @ApiOperation({ summary: 'Atualiza uma linha de serviço' })
  async updateServico(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('servicoId', ParseUUIDPipe) servicoId: string,
    @Body() body: UpsertServicoExecutadoDto,
  ) {
    const updated = await this.servicos.updateManual(id, servicoId, await this.prepare(body));
    if (!updated) throw new NotFoundException('Serviço não encontrado neste atestado.');
    await this.semanticIndex.indexService(updated.id);
    return updated;
  }

  private async prepare(body: UpsertServicoExecutadoDto) {
    const unidade = body.unidade?.trim() || undefined;
    const resolved = await this.measurements.resolveUnit(unidade, body.descricao);
    return {
      categoria: body.categoria?.trim() || undefined,
      codigo: body.codigo?.trim() || undefined,
      descricao: body.descricao.trim(),
      unidade: resolved.canonicalSymbol ?? unidade,
      unitId: resolved.unitId,
      unitSymbolRaw: unidade,
      normalizedServiceKey: this.measurements.normalizeServiceKey(body.descricao),
      searchServiceKey: normalizeServiceSearchKey(body.descricao),
      quantidade: body.quantidade,
    };
  }
}
