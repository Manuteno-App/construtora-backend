export interface QualificationFilters {
  dataInicio?: string;
  dataFim?: string;
  localidade?: string;
  minValor?: number;
}

export interface ServicoBuscado {
  descricao: string;
  matchType?: ServiceMatchType;
  quantidade?: number;
  unidade?: string;
  unitId?: string;
  unidadeOriginal?: string;
  quantidadeConvertida?: number;
  unidadeComparada?: string;
  conversionKind?: 'DIRECT' | 'MATHEMATICAL' | 'TECHNICAL';
  conversionFactor?: number;
  itemCode?: string;
  pageNumber?: number;
  matchConfidence?: 'HIGH' | 'MEDIUM';
}

export type ServiceMatchType = 'EXATA' | 'POR_TERMOS' | 'TEXTUAL_FORTE';

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
  selectionRole?: 'MEETS_ALONE' | 'USED_IN_SUM' | 'USED_WITH_APPROXIMATION' | 'AVAILABLE_UNUSED';
  hasCaveat?: boolean;
}

export interface ResolvedDescricao {
  descricao: string;
  score: number;
  unidadeSugerida?: string;
}

export interface ServiceRequirement {
  criterionKey?: string;
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
  criterionKey?: string;
  serviceQuery: string;
  resolvedDescricoes: string[];
  matchingAtestados?: QualificationSource[];
  qualifyingAtestados: QualificationSource[];
  selectedAtestados?: QualificationSource[];
  totalQuantidade?: number;
  selectedTotalQuantidade?: number;
  availableTotalQuantidade?: number;
  matchingAtestadosCount?: number;
  quantidadeExigida?: number;
  percentualCobertura?: number;
  status?: 'ATENDIDO' | 'PARCIAL' | 'NAO_ATENDIDO';
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
  candidateAtestados?: QualificationSource[];
  conjunctionCandidateCount?: number;
  bestCandidateCoverageCount?: number;
  totalAtestadosBase?: number;
  matchingAtestadosCount?: number;
  elapsedMs?: number;
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
