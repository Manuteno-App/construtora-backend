import { Module } from '@nestjs/common';
import { QualificationService } from './core/service/qualification.service';
import { QualificationController } from './http/rest/controller/qualification.controller';
import { QualificationFacade } from './public-api/facade/qualification.facade';
import { QUALIFICATION_API } from './public-api/interface/qualification-api.interface';
import { MeasurementsModule } from '../measurements/measurements.module';
import { IndexingModule } from '../indexing/indexing.module';
import { ServiceSemanticIndexService } from './core/service/service-semantic-index.service';

@Module({
  imports: [MeasurementsModule, IndexingModule],
  providers: [
    QualificationService,
    ServiceSemanticIndexService,
    QualificationFacade,
    { provide: QUALIFICATION_API, useExisting: QualificationFacade },
  ],
  controllers: [QualificationController],
  exports: [
    QualificationService,
    ServiceSemanticIndexService,
    QualificationFacade,
    { provide: QUALIFICATION_API, useExisting: QualificationFacade },
  ],
})
export class QualificationModule {}
