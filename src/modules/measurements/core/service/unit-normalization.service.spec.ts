import { UnitNormalizationService } from './unit-normalization.service';

describe('UnitNormalizationService', () => {
  const service = new UnitNormalizationService();

  it('normaliza aliases conhecidos para o mesmo símbolo base', () => {
    expect(service.normalize('m²')).toBe('m2');
    expect(service.normalize('M2')).toBe('m2');
    expect(service.normalize('ton')).toBe('t');
    expect(service.normalize('Litros')).toBe('l');
  });

  it('remove quantidade grudada no símbolo e rejeita lixo numérico', () => {
    expect(service.normalize('50km')).toBe('km');
    expect(service.normalize('5cm')).toBe('cm');
    expect(service.normalize('0km')).toBe('km');
    expect(service.normalize('90x2')).toBe('');
  });

  it('identifica símbolos persistidos inválidos', () => {
    expect(service.isValidStoredSymbol('km')).toBe(true);
    expect(service.isValidStoredSymbol('50km')).toBe(false);
    expect(service.isValidStoredSymbol('90x2')).toBe(false);
  });

  it('gera chave estável para agrupar descrições de serviço', () => {
    expect(service.normalizeServiceKey('CBUQ Faixa C / Aplicação')).toBe('cbuq-faixa-c-aplicacao');
  });
});
