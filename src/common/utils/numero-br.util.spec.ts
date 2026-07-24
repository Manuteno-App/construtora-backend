import { parseNumeroBR } from './numero-br.util';

describe('parseNumeroBR', () => {
  it.each([
    ['10,26', 10.26],
    ['1.234,560', 1234.56],
    ['1', 1],
    ['10.26', 10.26],
    ['17.160m\u00b2', 17160],
    ['346,60m\u00b3', 346.6],
    ['210 ton', 210],
    ['54.186,830 t', 54186.83],
    ['5.000ml', 5000],
  ])('parses %s', (raw, expected) => expect(parseNumeroBR(raw)).toBe(expected));

  it.each(['', '10,26xyz', '1,2,3', 'abc'])('rejects invalid value %s', (raw) => {
    expect(parseNumeroBR(raw)).toBeUndefined();
  });

  it('parses a quantity followed by the unit extracted for the row', () => {
    expect(parseNumeroBR('12 UND.', 'und')).toBe(12);
  });
});
