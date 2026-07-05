import { DataSource } from 'typeorm';
import { QualificationService } from './qualification.service';
import { BundleCoverageResult, CumulativeResult, QualificationSource, ServiceCoverage } from '../../public-api/interface/qualification-api.interface';

const makeSource = (id: string, quantity?: number): QualificationSource => ({
  atestadoId: id,
  filename: `${id}.pdf`,
  obraNome: `Obra ${id}`,
  servicos: quantity !== undefined ? [{ descricao: `Servico ${id}`, quantidade: quantity, unidade: 'm2' }] : [],
});

describe('QualificationService.evaluateBundlePolicy', () => {
  let service: QualificationService;

  beforeEach(() => {
    service = new QualificationService(
      { query: jest.fn() } as unknown as DataSource,
      { convertQuantity: jest.fn(), normalizeServiceKey: jest.fn() } as any,
    );
  });

  it('marks global MAX as qualified when the minimum set fits the limit', async () => {
    const bundleResult: BundleCoverageResult = {
      minimumSet: [makeSource('A1'), makeSource('A2')],
      coverageByService: [
        {
          serviceQuery: 'Pavimentacao',
          resolvedDescricoes: ['Pavimentacao'],
          qualifyingAtestados: [makeSource('A1'), makeSource('A2')],
          covered: true,
        },
      ],
      fullyQualified: true,
    };
    jest.spyOn(service, 'findBundleSingleCoverage').mockResolvedValue(bundleResult);

    const result = await service.evaluateBundlePolicy({
      bundleMode: 'MAX',
      maxAtestados: 2,
      services: [{ query: 'Pavimentacao' }],
    });

    expect(result.fullyQualified).toBe(true);
    expect(result.exceededMaxAtestados).toBe(false);
    expect(result.usedAtestadosCount).toBe(2);
    expect(result.coverageByService[0].qualified).toBe(true);
  });

  it('marks global MAX as not qualified when the minimum set exceeds the limit', async () => {
    const bundleResult: BundleCoverageResult = {
      minimumSet: [makeSource('A1'), makeSource('A2'), makeSource('A3')],
      coverageByService: [
        {
          serviceQuery: 'Pavimentacao',
          resolvedDescricoes: ['Pavimentacao'],
          qualifyingAtestados: [makeSource('A1'), makeSource('A2'), makeSource('A3')],
          covered: true,
        },
      ],
      fullyQualified: true,
    };
    jest.spyOn(service, 'findBundleSingleCoverage').mockResolvedValue(bundleResult);

    const result = await service.evaluateBundlePolicy({
      bundleMode: 'MAX',
      maxAtestados: 2,
      services: [{ query: 'Pavimentacao' }],
    });

    expect(result.fullyQualified).toBe(false);
    expect(result.exceededMaxAtestados).toBe(true);
    expect(result.coverageByService[0].qualified).toBe(false);
    expect(result.coverageByService[0].failureReason).toBe('MAX_ATESTADOS_EXCEEDED');
  });

  it('supports MANY mode with mixed per-service proof policies', async () => {
    jest.spyOn(service, 'resolveDescricoes').mockImplementation(async (query: string) => [{ descricao: query, score: 1 }]);
    jest.spyOn(service, 'findAtestadosComServico').mockImplementation(async (descricoes: string[]) => {
      if (descricoes[0] === 'Servico ONE') return [makeSource('A1')];
      return [];
    });
    jest.spyOn(service, 'findCumulativoAtestados').mockImplementation(async (descricoes: string[], minQty: number) => {
      if (descricoes[0] === 'Servico MAX') {
        return {
          atestados: [makeSource('A2', 6), makeSource('A3', 4)],
          totalQuantidade: 10,
          meetsMinimum: true,
          minQuantidade: minQty,
        } satisfies CumulativeResult;
      }
      return {
        atestados: [makeSource('A3', 5)],
        totalQuantidade: 5,
        meetsMinimum: true,
        minQuantidade: minQty,
      } satisfies CumulativeResult;
    });

    const result = await service.evaluateBundlePolicy({
      bundleMode: 'MANY',
      services: [
        { query: 'Servico ONE', proofMode: 'ONE' },
        { query: 'Servico MAX', proofMode: 'MAX', maxAtestados: 2, minQuantidade: 10 },
        { query: 'Servico MANY', proofMode: 'MANY', minQuantidade: 5 },
      ],
    });

    expect(result.fullyQualified).toBe(true);
    expect(result.usedAtestadosCount).toBe(3);
    expect(result.coverageByService.every((coverage) => coverage.qualified)).toBe(true);
    expect(result.coverageByService[1].usedAtestadosCount).toBe(2);
  });

  it('fails a MAX line when it needs more atestados than allowed', async () => {
    jest.spyOn(service, 'resolveDescricoes').mockResolvedValue([{ descricao: 'Servico MAX', score: 1 }]);
    jest.spyOn(service, 'findCumulativoAtestados').mockResolvedValue({
      atestados: [makeSource('A1', 4), makeSource('A2', 3), makeSource('A3', 3)],
      totalQuantidade: 10,
      meetsMinimum: true,
      minQuantidade: 10,
    });

    const result = await service.evaluateBundlePolicy({
      bundleMode: 'MANY',
      services: [{ query: 'Servico MAX', proofMode: 'MAX', maxAtestados: 2, minQuantidade: 10 }],
    });

    const coverage = result.coverageByService[0] as ServiceCoverage;
    expect(result.fullyQualified).toBe(false);
    expect(coverage.qualified).toBe(false);
    expect(coverage.failureReason).toBe('MAX_ATESTADOS_EXCEEDED');
    expect(coverage.usedAtestadosCount).toBe(3);
  });
});
