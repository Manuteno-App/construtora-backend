import { Module } from '@nestjs/common';
import { QualificationService } from './core/service/qualification.service';
import { QualificationController } from './http/rest/controller/qualification.controller';
import { QualificationFacade } from './public-api/facade/qualification.facade';
import { QUALIFICATION_API } from './public-api/interface/qualification-api.interface';

@Module({
  providers: [
    QualificationService,
    QualificationFacade,
    { provide: QUALIFICATION_API, useExisting: QualificationFacade },
  ],
  controllers: [QualificationController],
  exports: [
    QualificationService,
    QualificationFacade,
    { provide: QUALIFICATION_API, useExisting: QualificationFacade },
  ],
})
export class QualificationModule {}
