import { Controller, Get, Param, Query, ParseUUIDPipe, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IExtractionApi, EXTRACTION_API } from '../../../public-api/interface/extraction-api.interface';

@ApiTags('extraction')
@Controller('extraction')
export class ExtractionController {
  constructor(
    @Inject(EXTRACTION_API) private readonly extractionApi: IExtractionApi,
  ) {}

  @Get(':atestadoId/entities')
  @ApiOperation({ summary: 'Entidades extraídas (obra, empresa, contrato)' })
  getEntities(@Param('atestadoId', ParseUUIDPipe) atestadoId: string) {
    return this.extractionApi.getEntidadesByAtestadoId(atestadoId);
  }

  @Get(':atestadoId/servicos')
  @ApiOperation({ summary: 'Serviços executados de um atestado' })
  @ApiQuery({ name: 'categoria', required: false })
  getServicos(
    @Param('atestadoId', ParseUUIDPipe) atestadoId: string,
    @Query('categoria') categoria?: string,
  ) {
    return this.extractionApi.getServicosByAtestadoId(atestadoId, categoria);
  }
}

/**
 * Secondary controller: exposes the /atestados/:id/servicos URL
 * within the ExtractionModule to avoid circular dependencies.
 */
@ApiTags('atestados')
@Controller('atestados')
export class AtestadoServicosController {
  constructor(
    @Inject(EXTRACTION_API) private readonly extractionApi: IExtractionApi,
  ) {}

  @Get(':id/servicos')
  @ApiOperation({ summary: 'Tabela de serviços executados de um atestado' })
  @ApiQuery({ name: 'categoria', required: false })
  findServicos(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('categoria') categoria?: string,
  ) {
    return this.extractionApi.getServicosByAtestadoId(id, categoria);
  }
}
