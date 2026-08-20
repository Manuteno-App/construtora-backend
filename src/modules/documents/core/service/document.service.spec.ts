import { AtestadoCategoria } from '../../persistence/entity/atestado.entity';
import { categoryFromFilename } from './document.service';

describe('categoryFromFilename', () => {
  it.each([
    ['ST - rodovia.pdf', AtestadoCategoria.EST],
    ['EST - rodovia.pdf', AtestadoCategoria.EST],
    ['EST 001 - rodovia.pdf', AtestadoCategoria.EST],
    ['EST_001_rodovia.pdf', AtestadoCategoria.EST],
    [' est - rodovia.pdf', AtestadoCategoria.EST],
    ['CIV - edificio.pdf', AtestadoCategoria.CIV],
    ['arquivo EST.pdf', undefined],
  ])('classifies %s as %s', (filename, expected) => {
    expect(categoryFromFilename(filename)).toBe(expected);
  });
});
