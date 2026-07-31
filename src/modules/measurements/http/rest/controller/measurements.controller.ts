import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MeasurementsService } from '../../../core/service/measurements.service';
import { ListUnitsQueryDto } from '../dto/measurements-admin.dto';
import { UnitStatus } from '../../../persistence/entity/unit.entity';

@ApiTags('measurements')
@Controller('measurements')
export class MeasurementsController {
  constructor(private readonly measurements: MeasurementsService) {}

  @Get('units')
  @ApiOperation({ summary: 'Lista unidades de medida ativas para seleção' })
  @ApiQuery({ name: 'search', required: false })
  units(@Query() query: ListUnitsQueryDto) {
    return this.measurements.listUnits({ search: query.search, status: UnitStatus.ACTIVE });
  }
}
