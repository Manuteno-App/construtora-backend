import { Injectable } from '@nestjs/common';
import { MeasurementsService } from '../../core/service/measurements.service';
import { IMeasurementsApi } from '../interface/measurements-api.interface';

@Injectable()
export class MeasurementsFacade implements IMeasurementsApi {
  constructor(private readonly service: MeasurementsService) {}

  resolveUnit = this.service.resolveUnit.bind(this.service);
  convertQuantity = this.service.convertQuantity.bind(this.service);
  normalizeServiceKey = this.service.normalizeServiceKey.bind(this.service);
  listFamilies = this.service.listFamilies.bind(this.service);
  listUnits = this.service.listUnits.bind(this.service);
  listConversions = this.service.listConversions.bind(this.service);
  listTechnicalConversions = this.service.listTechnicalConversions.bind(this.service);
  createOrUpdateUnit = this.service.createOrUpdateUnit.bind(this.service);
  createOrUpdateMathematicalConversion = this.service.createOrUpdateMathematicalConversion.bind(this.service);
  createOrUpdateTechnicalConversion = this.service.createOrUpdateTechnicalConversion.bind(this.service);
  updateTechnicalConversionStatus = this.service.updateTechnicalConversionStatus.bind(this.service);
}
