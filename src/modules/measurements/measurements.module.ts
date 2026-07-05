import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceUnitObservation } from './persistence/entity/service-unit-observation.entity';
import { TechnicalUnitConversion } from './persistence/entity/technical-unit-conversion.entity';
import { UnitConversion } from './persistence/entity/unit-conversion.entity';
import { UnitFamily } from './persistence/entity/unit-family.entity';
import { Unit } from './persistence/entity/unit.entity';
import { ServiceUnitObservationRepository } from './persistence/repository/service-unit-observation.repository';
import { TechnicalUnitConversionRepository } from './persistence/repository/technical-unit-conversion.repository';
import { UnitConversionRepository } from './persistence/repository/unit-conversion.repository';
import { UnitFamilyRepository } from './persistence/repository/unit-family.repository';
import { UnitRepository } from './persistence/repository/unit.repository';
import { MeasurementsFacade } from './public-api/facade/measurements.facade';
import { MEASUREMENTS_API } from './public-api/interface/measurements-api.interface';
import { MeasurementsService } from './core/service/measurements.service';
import { UnitNormalizationService } from './core/service/unit-normalization.service';
import { MeasurementsAdminController } from './http/rest/controller/measurements-admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([UnitFamily, Unit, UnitConversion, TechnicalUnitConversion, ServiceUnitObservation]),
  ],
  providers: [
    UnitFamilyRepository,
    UnitRepository,
    UnitConversionRepository,
    TechnicalUnitConversionRepository,
    ServiceUnitObservationRepository,
    UnitNormalizationService,
    MeasurementsService,
    MeasurementsFacade,
    { provide: MEASUREMENTS_API, useExisting: MeasurementsFacade },
  ],
  exports: [
    MeasurementsService,
    MeasurementsFacade,
    { provide: MEASUREMENTS_API, useExisting: MeasurementsFacade },
  ],
  controllers: [MeasurementsAdminController],
})
export class MeasurementsModule {}
