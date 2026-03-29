import {
  Controller,
  Get,
  Param,
  Delete,
  Query,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Atestado, AtestadoStatus } from '../database/entities/atestado.entity';
import { ServicoExecutado } from '../database/entities/servico-executado.entity';
import { StorageService } from '../storage/storage.service';

@ApiTags('atestados')
@Controller('atestados')
export class AtestadosController {
  constructor(
    @InjectRepository(Atestado)
    private readonly atestadoRepo: Repository<Atestado>,
    @InjectRepository(ServicoExecutado)
    private readonly servicoRepo: Repository<ServicoExecutado>,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista todos os atestados indexados' })
  @ApiQuery({ name: 'status', enum: AtestadoStatus, required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async findAll(
    @Query('status') status?: AtestadoStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    const qb = this.atestadoRepo
      .createQueryBuilder('a')
      .orderBy('a.createdAt', 'DESC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit));

    if (status) {
      qb.where('a.status = :status', { status });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de um atestado com entidades extraídas' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const atestado = await this.atestadoRepo.findOne({
      where: { id },
      relations: ['obras', 'obras.contratos', 'obras.contratos.empresa'],
    });
    if (!atestado) throw new NotFoundException(`Atestado ${id} não encontrado`);
    return atestado;
  }

  @Get(':id/servicos')
  @ApiOperation({ summary: 'Tabela de serviços executados de um atestado' })
  @ApiQuery({ name: 'categoria', required: false })
  async findServicos(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('categoria') categoria?: string,
  ) {
    const qb = this.servicoRepo
      .createQueryBuilder('s')
      .where('s.atestadoId = :id', { id })
      .orderBy('s.categoria', 'ASC')
      .addOrderBy('s.codigo', 'ASC');

    if (categoria) {
      qb.andWhere('UPPER(s.categoria) = UPPER(:categoria)', { categoria });
    }

    return qb.getMany();
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove atestado, chunks, embeddings e arquivo S3' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const atestado = await this.atestadoRepo.findOne({ where: { id } });
    if (!atestado) throw new NotFoundException(`Atestado ${id} não encontrado`);

    await this.storage.delete(atestado.s3Key).catch(() => {
      /* file may not exist */
    });
    await this.atestadoRepo.delete(id);
    return { deleted: true };
  }
}
