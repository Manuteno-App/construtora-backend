import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MeasurementsService } from '../../../core/service/measurements.service';
import {
  ListTechnicalConversionsQueryDto,
  ListUnitsQueryDto,
  UpdateTechnicalConversionStatusDto,
  UpsertMathematicalConversionDto,
  UpsertTechnicalConversionDto,
  UpsertUnitDto,
} from '../dto/measurements-admin.dto';

@ApiTags('measurements-admin')
@Controller('measurement-admin')
export class MeasurementsAdminController {
  constructor(private readonly measurements: MeasurementsService) {}

  @Get('families')
  @ApiOperation({ summary: 'Lista famílias de unidades' })
  families() {
    return this.measurements.listFamilies();
  }

  @Get('units')
  @ApiOperation({ summary: 'Lista unidades' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'familyId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'origin', required: false })
  units(@Query() query: ListUnitsQueryDto) {
    return this.measurements.listUnits(query);
  }

  @Post('units')
  @ApiOperation({ summary: 'Cria unidade' })
  createUnit(@Body() body: UpsertUnitDto) {
    return this.measurements.createOrUpdateUnit(body);
  }

  @Patch('units/:id')
  @ApiOperation({ summary: 'Atualiza unidade' })
  updateUnit(@Param('id') id: string, @Body() body: UpsertUnitDto) {
    return this.measurements.createOrUpdateUnit(body, id);
  }

  @Get('conversions')
  @ApiOperation({ summary: 'Lista conversões matemáticas' })
  conversions() {
    return this.measurements.listConversions();
  }

  @Post('conversions')
  @ApiOperation({ summary: 'Cria conversão matemática' })
  createConversion(@Body() body: UpsertMathematicalConversionDto) {
    return this.measurements.createOrUpdateMathematicalConversion(body);
  }

  @Patch('conversions/:id')
  @ApiOperation({ summary: 'Atualiza conversão matemática' })
  updateConversion(@Param('id') id: string, @Body() body: UpsertMathematicalConversionDto) {
    return this.measurements.createOrUpdateMathematicalConversion(body, id);
  }

  @Get('technical-conversions')
  @ApiOperation({ summary: 'Lista conversões técnicas e sugestões' })
  technicalConversions(@Query() query: ListTechnicalConversionsQueryDto) {
    return this.measurements.listTechnicalConversions(query.status);
  }

  @Post('technical-conversions')
  @ApiOperation({ summary: 'Cria conversão técnica' })
  createTechnicalConversion(@Body() body: UpsertTechnicalConversionDto) {
    return this.measurements.createOrUpdateTechnicalConversion(body);
  }

  @Patch('technical-conversions/:id')
  @ApiOperation({ summary: 'Atualiza conversão técnica' })
  updateTechnicalConversion(@Param('id') id: string, @Body() body: UpsertTechnicalConversionDto) {
    return this.measurements.createOrUpdateTechnicalConversion(body, id);
  }

  @Patch('technical-conversions/:id/status')
  @ApiOperation({ summary: 'Atualiza status da conversão técnica' })
  updateTechnicalConversionStatus(@Param('id') id: string, @Body() body: UpdateTechnicalConversionStatusDto) {
    return this.measurements.updateTechnicalConversionStatus(id, body.status);
  }
}
