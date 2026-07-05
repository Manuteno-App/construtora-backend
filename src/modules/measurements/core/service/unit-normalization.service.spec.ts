import { UnitNormalizationService } from './unit-normalization.service';

describe('UnitNormalizationService', () => {
  const service = new UnitNormalizationService();

  it('normaliza aliases conhecidos para o mesmo símbolo base', () => {
    expect(service.normalize('m²')).toBe('m2');
    expect(service.normalize('M2')).toBe('m2');
    expect(service.normalize('ton')).toBe('t');
    expect(service.normalize('Litros')).toBe('l');
  });

  it('gera chave estável para agrupar descrições de serviço', () => {
    expect(service.normalizeServiceKey('CBUQ Faixa C / Aplicação')).toBe('cbuq-faixa-c-aplicacao');
  });
});
