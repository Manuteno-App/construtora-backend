import { Injectable } from '@nestjs/common';
import { QualificationService } from '../../core/service/qualification.service';
import {
  BundleEvaluationRequest,
  BundleEvaluationResult,
  BundleCoverageResult,
  CumulativeResult,
  IQualificationApi,
  QualificationFilters,
  QualificationSource,
  ResolvedDescricao,
  ServiceCoverage,
  ServiceRequirement,
} from '../interface/qualification-api.interface';

@Injectable()
export class QualificationFacade implements IQualificationApi {
  constructor(private readonly qualificationService: QualificationService) {}

  resolveDescricoes(query: string): Promise<ResolvedDescricao[]> {
    return this.qualificationService.resolveDescricoes(query);
  }

  findAtestadosComServico(descricoes: string[], filters?: QualificationFilters): Promise<QualificationSource[]> {
    return this.qualificationService.findAtestadosComServico(descricoes, filters);
  }

  findAtestadosComQuantidadeMinima(
    descricoes: string[],
    minQty: number,
    unidade?: string,
    filters?: QualificationFilters,
  ): Promise<QualificationSource[]> {
    return this.qualificationService.findAtestadosComQuantidadeMinima(descricoes, minQty, unidade, filters);
  }

  findCumulativoAtestados(
    descricoes: string[],
    minQty: number,
    unidade?: string,
    filters?: QualificationFilters,
  ): Promise<CumulativeResult> {
    return this.qualificationService.findCumulativoAtestados(descricoes, minQty, unidade, filters);
  }

  findBundleSingleCoverage(
    services: ServiceRequirement[],
    filters?: QualificationFilters,
  ): Promise<BundleCoverageResult> {
    return this.qualificationService.findBundleSingleCoverage(services, filters);
  }

  findBundleCumulativeCoverage(
    services: ServiceRequirement[],
    filters?: QualificationFilters,
  ): Promise<ServiceCoverage[]> {
    return this.qualificationService.findBundleCumulativeCoverage(services, filters);
  }

  evaluateBundlePolicy(request: BundleEvaluationRequest): Promise<BundleEvaluationResult> {
    return this.qualificationService.evaluateBundlePolicy(request);
  }
}
