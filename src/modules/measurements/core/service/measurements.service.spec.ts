import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueryFailedError } from 'typeorm';
import { MeasurementsService } from './measurements.service';
import { UnitFamily } from '../../persistence/entity/unit-family.entity';

describe('MeasurementsService', () => {
  const normalization = {
    normalize: (value?: string | null) => value?.toLowerCase().trim() ?? '',
    canonicalize: (value: string) => value,
    normalizeServiceKey: (value: string) => value.toLowerCase().replace(/\s+/g, '-'),
  };

  const config = {
    get: jest.fn(() => undefined),
  } as unknown as ConfigService;

  const familiesRepo = {
    findAll: jest.fn(),
    findById: jest.fn(),
    findBySlug: jest.fn(),
  };

  const unitsRepo = {
    findById: jest.fn(),
    findByCanonicalSymbol: jest.fn(),
    findByNormalizedOrAlias: jest.fn(),
    list: jest.fn(),
    createEntity: jest.fn((data) => data),
    saveEntity: jest.fn(async (data) => ({ id: 'unit', ...data })),
    updateEntity: jest.fn(),
  };

  const conversionsRepo = {
    findAll: jest.fn(),
    findByPair: jest.fn(),
    createEntity: jest.fn((data) => data),
    saveEntity: jest.fn(async (data) => ({ id: 'conv', ...data })),
    updateEntity: jest.fn(),
  };

  const technicalRepo = {
    list: jest.fn(),
    findById: jest.fn(),
    findApprovedByKeyAndPair: jest.fn(),
    findExisting: jest.fn(),
    createEntity: jest.fn((data) => data),
    saveEntity: jest.fn(async (data) => ({ id: 'tech', ...data })),
    updateEntity: jest.fn(),
  };

  const observationsRepo = {
    findGroupedCandidates: jest.fn(),
    saveEntity: jest.fn(),
    createEntity: jest.fn((data) => data),
  };

  const service = new MeasurementsService(
    config,
    familiesRepo as any,
    unitsRepo as any,
    conversionsRepo as any,
    technicalRepo as any,
    observationsRepo as any,
    normalization as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('impede conversão matemática entre famílias diferentes', async () => {
    unitsRepo.findById
      .mockResolvedValueOnce({ id: 'u1', familyId: 'f1' })
      .mockResolvedValueOnce({ id: 'u2', familyId: 'f2' });

    await expect(
      service.createOrUpdateMathematicalConversion({
        sourceUnitId: 'u1',
        targetUnitId: 'u2',
        factor: 1000,
      }),
    ).rejects.toThrow('Conversões matemáticas só podem existir entre unidades da mesma família');
  });

  it('cria unidade com família conhecida e origem de usuário por padrão', async () => {
    const family: UnitFamily = {
      id: 'fam',
      name: 'Massa',
      slug: 'massa',
      status: 'ACTIVE' as any,
      units: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    familiesRepo.findBySlug.mockResolvedValue(family);

    const created = await service.createOrUpdateUnit({
      name: 'Quilograma',
      canonicalSymbol: 'kg',
      familyId: family.id,
    });

    expect(created.origin).toBe('USER');
    expect(created.familyId).toBe(family.id);
  });

  it('retorna conversão técnica com evidence parseado', async () => {
    const sourceUnit = { id: 'u1', canonicalSymbol: 't' };
    const targetUnit = { id: 'u2', canonicalSymbol: 'm3' };
    technicalRepo.saveEntity.mockResolvedValueOnce({
      id: 'tech-1',
      serviceDescription: 'CBUQ',
      normalizedServiceKey: 'cbuq',
      sourceUnitId: 'u1',
      targetUnitId: 'u2',
      factor: 2.35,
      ruleOrigin: 'USER',
      status: 'APPROVED',
      evidenceJson: '{"foo":"bar"}',
      sourceUnit,
      targetUnit,
    });

    const created = await service.createOrUpdateTechnicalConversion({
      serviceDescription: 'CBUQ',
      sourceUnitId: 'u1',
      targetUnitId: 'u2',
      factor: 2.35,
    });

    expect(created.evidence).toEqual({ foo: 'bar' });
    expect(created.sourceUnit).toBe(sourceUnit);
  });

  it('reaproveita conversão técnica existente ao criar a mesma chave lógica', async () => {
    technicalRepo.findExisting.mockResolvedValueOnce({ id: 'tech-existing' });
    technicalRepo.updateEntity.mockResolvedValueOnce({
      id: 'tech-existing',
      serviceDescription: 'CBUQ',
      normalizedServiceKey: 'cbuq',
      sourceUnitId: 'u1',
      targetUnitId: 'u2',
      factor: 2.4,
      ruleOrigin: 'USER',
      status: 'PENDING',
      evidenceJson: '{}',
    });

    const created = await service.createOrUpdateTechnicalConversion({
      serviceDescription: 'CBUQ',
      sourceUnitId: 'u1',
      targetUnitId: 'u2',
      factor: 2.4,
    });

    expect(technicalRepo.saveEntity).not.toHaveBeenCalled();
    expect(technicalRepo.updateEntity).toHaveBeenCalledWith('tech-existing', expect.objectContaining({
      normalizedServiceKey: 'cbuq',
      sourceUnitId: 'u1',
      targetUnitId: 'u2',
    }));
    expect(created.id).toBe('tech-existing');
  });

  it('resolve corrida de unique key buscando e atualizando a conversão criada em paralelo', async () => {
    const duplicateError = Object.assign(
      new QueryFailedError('INSERT', [], new Error('duplicate key value')),
      { driverError: { code: '23505' } },
    );
    technicalRepo.findExisting
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'tech-race' });
    technicalRepo.saveEntity.mockRejectedValueOnce(duplicateError);
    technicalRepo.updateEntity.mockResolvedValueOnce({
      id: 'tech-race',
      serviceDescription: 'CBUQ',
      normalizedServiceKey: 'cbuq',
      sourceUnitId: 'u1',
      targetUnitId: 'u2',
      factor: 2.35,
      ruleOrigin: 'AI',
      status: 'PENDING',
      evidenceJson: '{}',
    });

    const created = await service.createOrUpdateTechnicalConversion({
      serviceDescription: 'CBUQ',
      sourceUnitId: 'u1',
      targetUnitId: 'u2',
      factor: 2.35,
      ruleOrigin: 'AI' as any,
      status: 'PENDING' as any,
    });

    expect(technicalRepo.updateEntity).toHaveBeenCalledWith('tech-race', expect.objectContaining({
      normalizedServiceKey: 'cbuq',
      sourceUnitId: 'u1',
      targetUnitId: 'u2',
    }));
    expect(created.id).toBe('tech-race');
  });

  it('bloqueia atualização quando já existe outra conversão com a mesma chave lógica', async () => {
    technicalRepo.findExisting.mockResolvedValueOnce({ id: 'other-tech' });

    await expect(
      service.createOrUpdateTechnicalConversion({
        serviceDescription: 'CBUQ',
        sourceUnitId: 'u1',
        targetUnitId: 'u2',
        factor: 2.35,
      }, 'tech-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('não sugere conversão técnica com amostra fraca', async () => {
    observationsRepo.findGroupedCandidates.mockResolvedValueOnce([
      {
        normalizedServiceKey: 'cbuq',
        serviceDescription: 'CBUQ',
        unitId: 'u1',
        unitSymbol: 't',
        familyId: 'massa',
        familyName: 'Massa',
        sampleCount: '1',
        avgQuantity: '10',
      },
      {
        normalizedServiceKey: 'cbuq',
        serviceDescription: 'CBUQ',
        unitId: 'u2',
        unitSymbol: 'm3',
        familyId: 'volume',
        familyName: 'Volume',
        sampleCount: '1',
        avgQuantity: '5',
      },
    ]);

    await service.recordServiceObservation({
      atestadoId: 'a1',
      serviceDescription: 'CBUQ',
      unitId: 'u1',
      quantity: 10,
      rawUnitSymbol: 't',
    });

    expect(technicalRepo.saveEntity).not.toHaveBeenCalled();
  });
});
