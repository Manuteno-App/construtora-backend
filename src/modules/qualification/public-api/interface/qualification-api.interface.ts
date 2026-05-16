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
}

export interface ServiceCoverage {
  serviceQuery: string;
  resolvedDescricoes: string[];
  qualifyingAtestados: QualificationSource[];
  totalQuantidade?: number;
  covered: boolean;
}

export interface BundleCoverageResult {
  minimumSet: QualificationSource[];
  coverageByService: ServiceCoverage[];
  fullyQualified: boolean;
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
    filters?: QualificationFilters,
  ): Promise<QualificationSource[]>;
  findCumulativoAtestados(
    descricoes: string[],
    minQty: number,
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
}

export const QUALIFICATION_API = Symbol('IQualificationApi');
