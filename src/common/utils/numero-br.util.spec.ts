import { parseNumeroBR } from './numero-br.util';

describe('parseNumeroBR', () => {
  it.each([
    ['10,26', 10.26],
    ['1.234,560', 1234.56],
    ['1', 1],
    ['10.26', 10.26],
  ])('parses %s', (raw, expected) => expect(parseNumeroBR(raw)).toBe(expected));

  it.each(['', '10,26m', '1,2,3', 'abc'])('rejects invalid value %s', (raw) => {
    expect(parseNumeroBR(raw)).toBeUndefined();
  });
});
