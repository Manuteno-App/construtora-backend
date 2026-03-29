import { Controller, Get, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Obra } from '../database/entities/obra.entity';
import { ServicoExecutado } from '../database/entities/servico-executado.entity';

@ApiTags('extraction')
@Controller('extraction')
export class ExtractionController {
  constructor(
    @InjectRepository(Obra)
    private readonly obraRepo: Repository<Obra>,
    @InjectRepository(ServicoExecutado)
    private readonly servicoRepo: Repository<ServicoExecutado>,
  ) {}

  @Get(':atestadoId/entities')
  @ApiOperation({ summary: 'Entidades extraídas (obra, empresa, contrato) de um atestado' })
  async getEntities(@Param('atestadoId', ParseUUIDPipe) atestadoId: string) {
    return this.obraRepo.find({
      where: { atestadoId },
      relations: ['contratos', 'contratos.empresa'],
    });
  }

  @Get(':atestadoId/servicos')
  @ApiOperation({ summary: 'Serviços executados de um atestado' })
  @ApiQuery({ name: 'categoria', required: false })
  async getServicos(
    @Param('atestadoId', ParseUUIDPipe) atestadoId: string,
    @Query('categoria') categoria?: string,
  ) {
    const qb = this.servicoRepo
      .createQueryBuilder('s')
      .where('s.atestadoId = :atestadoId', { atestadoId })
      .orderBy('s.categoria')
      .addOrderBy('s.codigo');

    if (categoria) {
      qb.andWhere('UPPER(s.categoria) = UPPER(:categoria)', { categoria });
    }

    return qb.getMany();
  }
}
