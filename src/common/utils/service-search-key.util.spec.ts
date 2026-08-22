import { normalizeServiceSearchKey } from './service-search-key.util';

describe('normalizeServiceSearchKey', () => {
  it.each([
    'Regularização de subleito',
    'Regularização do subleito',
    'Regularização de sub-leito',
    'Regularização do sub-leito',
    'Regularização subleito',
    'Regularização  sub-leito',
  ])('normaliza %s como a mesma chave de busca', (description) => {
    expect(normalizeServiceSearchKey(description)).toBe(
      'regularizacaosubleito',
    );
  });
});
