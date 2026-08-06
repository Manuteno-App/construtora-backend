import { DataSource } from 'typeorm';
import {
  BundleCoverageResult,
  CumulativeResult,
  QualificationSource,
  ServiceCoverage,
} from '../../public-api/interface/qualification-api.interface';
import { QualificationService } from './qualification.service';

const makeSource = (id: string, quantity?: number): QualificationSource => ({
  atestadoId: id,
  filename: `${id}.pdf`,
  obraNome: `Obra ${id}`,
  servicos:
    quantity !== undefined
      ? [{ descricao: `Servico ${id}`, quantidade: quantity, unidade: 'm2' }]
      : [],
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
    jest
      .spyOn(service, 'findBundleSingleCoverage')
      .mockResolvedValue(bundleResult);

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
          qualifyingAtestados: [
            makeSource('A1'),
            makeSource('A2'),
            makeSource('A3'),
          ],
          covered: true,
        },
      ],
      fullyQualified: true,
    };
    jest
      .spyOn(service, 'findBundleSingleCoverage')
      .mockResolvedValue(bundleResult);

    const result = await service.evaluateBundlePolicy({
      bundleMode: 'MAX',
      maxAtestados: 2,
      services: [{ query: 'Pavimentacao' }],
    });

    expect(result.fullyQualified).toBe(false);
    expect(result.exceededMaxAtestados).toBe(true);
    expect(result.coverageByService[0].qualified).toBe(false);
    expect(result.coverageByService[0].failureReason).toBe(
      'MAX_ATESTADOS_EXCEEDED',
    );
  });

  it('supports MANY mode with mixed per-service proof policies', async () => {
    jest
      .spyOn(service, 'resolveDescricoes')
      .mockImplementation(async (query: string) => [
        { descricao: query, score: 1 },
      ]);
    jest
      .spyOn(service, 'findAtestadosComServico')
      .mockImplementation(async (descricoes: string[]) => {
        if (descricoes[0] === 'Servico ONE') return [makeSource('A1')];
        return [];
      });
    jest
      .spyOn(service, 'findCumulativoAtestados')
      .mockImplementation(async (descricoes: string[], minQty: number) => {
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
        {
          query: 'Servico MAX',
          proofMode: 'MAX',
          maxAtestados: 2,
          minQuantidade: 10,
        },
        { query: 'Servico MANY', proofMode: 'MANY', minQuantidade: 5 },
      ],
    });

    expect(result.fullyQualified).toBe(true);
    expect(result.usedAtestadosCount).toBe(3);
    expect(
      result.coverageByService.every((coverage) => coverage.qualified),
    ).toBe(true);
    expect(result.coverageByService[1].usedAtestadosCount).toBe(2);
  });

  it('fails a MAX line when it needs more atestados than allowed', async () => {
    jest
      .spyOn(service, 'resolveDescricoes')
      .mockResolvedValue([{ descricao: 'Servico MAX', score: 1 }]);
    jest.spyOn(service, 'findCumulativoAtestados').mockResolvedValue({
      atestados: [
        makeSource('A1', 4),
        makeSource('A2', 3),
        makeSource('A3', 3),
      ],
      totalQuantidade: 10,
      meetsMinimum: true,
      minQuantidade: 10,
    });

    const result = await service.evaluateBundlePolicy({
      bundleMode: 'MANY',
      services: [
        {
          query: 'Servico MAX',
          proofMode: 'MAX',
          maxAtestados: 2,
          minQuantidade: 10,
        },
      ],
    });

    const coverage = result.coverageByService[0] as ServiceCoverage;
    expect(result.fullyQualified).toBe(false);
    expect(coverage.qualified).toBe(false);
    expect(coverage.failureReason).toBe('MAX_ATESTADOS_EXCEEDED');
    expect(coverage.usedAtestadosCount).toBe(3);
  });

  it('returns every document that satisfies a ONE conjunction', async () => {
    jest
      .spyOn(service, 'findCumulativoAtestados')
      .mockImplementation(async (descricoes: string[], minQty: number) => ({
        atestados:
          descricoes[0] === 'Servico A'
            ? [makeSource('A1', 10), makeSource('A2', 12)]
            : [
                makeSource('A1', 10),
                makeSource('A2', 11),
                makeSource('A3', 20),
              ],
        totalQuantidade: 42,
        meetsMinimum: true,
        minQuantidade: minQty,
      }));

    const result = await service.evaluateBundlePolicy({
      bundleMode: 'ONE',
      services: [
        { criterionKey: 'a', query: 'Servico A', minQuantidade: 10 },
        { criterionKey: 'b', query: 'Servico B', minQuantidade: 10 },
      ],
    });

    expect(result.fullyQualified).toBe(true);
    expect(result.conjunctionCandidateCount).toBe(2);
    expect(result.candidateAtestados?.map((item) => item.atestadoId)).toEqual([
      'A1',
      'A2',
    ]);
    expect(result.bestCandidateCoverageCount).toBe(2);
    expect(result.coverageByService.map((item) => item.criterionKey)).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps quantity found in ONE as partial instead of no matches', async () => {
    jest.spyOn(service, 'findCumulativoAtestados').mockResolvedValue({
      atestados: [makeSource('A1', 5)],
      totalQuantidade: 5,
      meetsMinimum: false,
      minQuantidade: 10,
    });

    const result = await service.evaluateBundlePolicy({
      bundleMode: 'ONE',
      services: [
        {
          criterionKey: 'partial',
          query: 'Servico parcial',
          minQuantidade: 10,
        },
      ],
    });

    const coverage = result.coverageByService[0];
    expect(result.fullyQualified).toBe(false);
    expect(result.conjunctionCandidateCount).toBe(0);
    expect(coverage.failureReason).toBe('INSUFFICIENT_QUANTITY');
    expect(coverage.matchingAtestadosCount).toBe(1);
    expect(coverage.availableTotalQuantidade).toBe(5);
    expect(coverage.selectedTotalQuantidade).toBe(0);
  });
  it('does not qualify a ONE criterion with only atestados below its minimum quantity', async () => {
    const partialSources = [
      makeSource('A1', 220000),
      makeSource('A2', 180000),
      makeSource('A3', 160000),
      makeSource('A4', 140000),
    ];
    jest.spyOn(service, 'findCumulativoAtestados').mockResolvedValue({
      atestados: partialSources,
      totalQuantidade: 700000,
      meetsMinimum: false,
      minQuantidade: 750000,
    });
    jest
      .spyOn(service, 'findAtestadosComQuantidadeMinima')
      .mockResolvedValue([]);

    const result = await service.evaluateBundlePolicy({
      bundleMode: 'MANY',
      services: [
        {
          query: 'Regularizacao de subleito',
          proofMode: 'ONE',
          minQuantidade: 750000,
          unidade: 'm2',
        },
      ],
    });

    const coverage = result.coverageByService[0];
    expect(result.fullyQualified).toBe(false);
    expect(coverage.qualified).toBe(false);
    expect(coverage.status).toBe('PARCIAL');
    expect(coverage.selectedAtestados).toEqual([]);
    expect(coverage.qualifyingAtestados).toEqual([]);
    expect(coverage.matchingAtestados).toHaveLength(4);
  });
  it('does not count duplicated extracted service rows more than once', async () => {
    const duplicatedRow = {
      atestadoId: 'A1',
      serviceId: 'service-1',
      filename: 'A1.pdf',
      obraNome: 'Obra A1',
      local: null,
      dataInicio: null,
      dataFim: null,
      valor: null,
      contratoNumero: null,
      descricao: 'Regularizacao do subleito',
      quantidade: '439140',
      unidade: 'm2',
      unitId: 'unit-m2',
      matchType: 'POR_TERMOS' as const,
      matchRank: 2,
      normalizedServiceKey: 'regularizacao-subleito',
      itemCode: '2.3',
      pageNumber: null,
      baixaConfianca: false,
    };

    const aggregated = await (service as any).aggregateRowsByAtestado([
      duplicatedRow,
      { ...duplicatedRow, itemCode: null },
      { ...duplicatedRow, unidade: 'm²' },
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].totalQuantidade).toBe(439140);
    expect(aggregated[0].servicos).toHaveLength(1);
  });
});


describe('QualificationService service-item aggregation', () => {
  it('sums distinct matching items from the same atestado', async () => {
    const service = new QualificationService(
      { query: jest.fn() } as unknown as DataSource,
      { convertQuantity: jest.fn(), normalizeServiceKey: jest.fn() } as any,
    );
    const baseRow = {
      atestadoId: 'A1',
      serviceId: 'service-1',
      filename: 'A1.pdf',
      obraNome: 'Obra A1',
      local: null,
      dataInicio: null,
      dataFim: null,
      valor: null,
      contratoNumero: null,
      numeroAtestado: null,
      extensaoKm: null,
      extensaoDeclaradaKm: null,
      kmInicial: null,
      kmFinal: null,
      extensaoCalculadaKm: null,
      descricao: 'Regularizacao do subleito',
      quantidade: '400000',
      unidade: 'm2',
      unitId: 'unit-m2',
      matchType: 'POR_TERMOS' as const,
      matchRank: 2,
      normalizedServiceKey: 'regularizacao-subleito',
      itemCode: null,
      pageNumber: null,
      baixaConfianca: false,
    };

    const aggregated = await (service as any).aggregateRowsByAtestado([
      baseRow,
      { ...baseRow, serviceId: 'service-2', quantidade: '350000' },
    ]);

    expect(aggregated[0].totalQuantidade).toBe(750000);
    expect(aggregated[0].servicos).toHaveLength(2);
  });
});
describe('QualificationService extension filter', () => {
  it('uses the informed extension as an exact criterion for the matched service', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new QualificationService(
      { query } as unknown as DataSource,
      { convertQuantity: jest.fn(), normalizeServiceKey: jest.fn() } as any,
    );

    await service.findAtestadosComServico(['Roçada Manual'], {
      extensaoKm: 42,
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('o.extensao_km = $3');
    expect(sql).not.toContain('o.extensao_km >=');
    expect(params).toEqual(['rocada-manual', 'Roçada Manual', 42]);
  });
});