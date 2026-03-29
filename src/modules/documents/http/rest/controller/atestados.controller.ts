import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { DocumentService } from '../../../core/service/document.service';
import { AtestadoStatus } from '../../../persistence/entity/atestado.entity';

@ApiTags('atestados')
@Controller('atestados')
export class AtestadosController {
  constructor(private readonly documentService: DocumentService) {}

  @Get()
  @ApiOperation({ summary: 'Lista todos os atestados indexados' })
  @ApiQuery({ name: 'status', enum: AtestadoStatus, required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  findAll(
    @Query('status') status?: AtestadoStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.documentService.listAtestados({
      status,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um atestado com entidades extraídas' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.documentService.findByIdWithRelations(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove atestado, chunks, embeddings e arquivo S3' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.documentService.delete(id);
    return { deleted: true };
  }
}
