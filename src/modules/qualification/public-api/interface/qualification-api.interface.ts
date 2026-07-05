export interface QualificationFilters {
  dataInicio?: string;
  dataFim?: string;
  localidade?: string;
  minValor?: number;
}

export interface ServicoBuscado {
  descricao: string;
  quantidade?: number;
  unidade?: string;
  unitId?: string;
  unidadeOriginal?: string;
  quantidadeConvertida?: number;
  unidadeComparada?: string;
  conversionKind?: 'DIRECT' | 'MATHEMATICAL' | 'TECHNICAL';
  conversionFactor?: number;
}

export interface QualificationSource {
  atestadoId: string;
  filename: string;
  obraNome: string;
  local?: string;
  dataInicio?: string;
  dataFim?: string;
  valor?: number;
  contratoNumero?: string;
  servicos?: ServicoBuscado[];
}

export interface ResolvedDescricao {
  descricao: string;
  score: number;
}

export interface ServiceRequirement {
  query: string;
  minQuantidade?: number;
  unidade?: string;
  proofMode?: ProofMode;
  maxAtestados?: number;
}

export type ProofMode = 'ONE' | 'MANY' | 'MAX';

export type QualificationFailureReason =
  | 'NO_MATCHES'
  | 'INSUFFICIENT_QUANTITY'
  | 'MAX_ATESTADOS_EXCEEDED';

export interface BundleEvaluationRequest {
  bundleMode: ProofMode;
  maxAtestados?: number;
  services: ServiceRequirement[];
  filters?: QualificationFilters;
}

export interface ServiceCoverage {
  serviceQuery: string;
  resolvedDescricoes: string[];
  qualifyingAtestados: QualificationSource[];
  selectedAtestados?: QualificationSource[];
  totalQuantidade?: number;
  usedAtestadosCount?: number;
  proofModeApplied?: ProofMode;
  maxAtestados?: number;
  withinLimit?: boolean;
  qualified?: boolean;
  failureReason?: QualificationFailureReason;
  covered: boolean;
}

export interface BundleCoverageResult {
  minimumSet: QualificationSource[];
  coverageByService: ServiceCoverage[];
  fullyQualified: boolean;
}

export interface BundleEvaluationResult {
  bundleModeApplied: ProofMode;
  maxAtestados?: number;
  selectedAtestados: QualificationSource[];
  usedAtestadosCount: number;
  coverageByService: ServiceCoverage[];
  fullyQualified: boolean;
  exceededMaxAtestados: boolean;
}

export interface CumulativeResult {
  atestados: QualificationSource[];
  totalQuantidade: number;
  meetsMinimum: boolean;
  minQuantidade: number;
}

export interface IQualificationApi {
  resolveDescricoes(query: string): Promise<ResolvedDescricao[]>;
  findAtestadosComServico(descricoes: string[], filters?: QualificationFilters): Promise<QualificationSource[]>;
  findAtestadosComQuantidadeMinima(
    descricoes: string[],
    minQty: number,
    unidade?: string,
    filters?: QualificationFilters,
  ): Promise<QualificationSource[]>;
  findCumulativoAtestados(
    descricoes: string[],
    minQty: number,
    unidade?: string,
    filters?: QualificationFilters,
  ): Promise<CumulativeResult>;
  findBundleSingleCoverage(
    services: ServiceRequirement[],
    filters?: QualificationFilters,
  ): Promise<BundleCoverageResult>;
  findBundleCumulativeCoverage(
    services: ServiceRequirement[],
    filters?: QualificationFilters,
  ): Promise<ServiceCoverage[]>;
  evaluateBundlePolicy(request: BundleEvaluationRequest): Promise<BundleEvaluationResult>;
}

export const QUALIFICATION_API = Symbol('IQualificationApi');
