import { DataSource } from 'typeorm';
import { QualificationService } from './qualification.service';

const VARIANTS = [
  'Regularização de subleito',
  'Regularização do subleito',
  'Regularização de sub-leito',
  'Regularização do sub-leito',
  'Regularização subleito',
  'Regularização  sub-leito',
];

describe('QualificationService tolerant service search', () => {
  it('uses the same canonical key for every autocomplete spelling', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new QualificationService(
      { query } as unknown as DataSource,
      { convertQuantity: jest.fn(), normalizeServiceKey: jest.fn() } as any,
    );

    for (const variant of VARIANTS) {
      await service.resolveDescricoes(variant);
    }

    expect(query).toHaveBeenCalledTimes(VARIANTS.length);
    for (const [, params] of query.mock.calls) {
      expect(params[2]).toBe('regularizacaosubleito');
    }
    expect(query.mock.calls[0][0]).toContain('search_service_key');
  });

  it('uses the canonical key in every CONTAINS qualification criterion', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const service = new QualificationService(
      { query } as unknown as DataSource,
      { convertQuantity: jest.fn(), normalizeServiceKey: jest.fn() } as any,
    );

    await service.findAtestadosComServico(VARIANTS);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('s.search_service_key LIKE');
    expect(params.filter((value: unknown) => value === 'regularizacaosubleito')).toHaveLength(
      VARIANTS.length,
    );
  });
});
