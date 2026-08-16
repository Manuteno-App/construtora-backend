import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { IQualificationApi } from '../../../qualification/public-api/interface/qualification-api.interface';
import { ConversationTurnRepository } from '../../persistence/repository/conversation-turn.repository';
import { CapabilityChatService, CapabilityPlan } from './capability-chat.service';

describe('CapabilityChatService planning', () => {
  let service: CapabilityChatService;
  let qualification: jest.Mocked<Pick<IQualificationApi, 'findCumulativoAtestados'>>;

  beforeEach(() => {
    qualification = { findCumulativoAtestados: jest.fn() };
    service = new CapabilityChatService(
      qualification as unknown as IQualificationApi,
      {} as ConversationTurnRepository,
      { get: jest.fn((key: string) => key === 'openaiApiKey' ? 'test-key' : undefined) } as unknown as ConfigService,
      {} as DataSource,
    );
  });

  it('keeps only the requirement service and uses cumulative proof by default', () => {
    const plan = (service as any).heuristicPlan(
      'Um edital exige pelo menos 500.000 m² de regularização de subleito. Consigo comprovar esse mínimo? Com quais atestados?',
    ) as CapabilityPlan;

    expect(plan).toMatchObject({
      operation: 'QUALIFICATION',
      bundleMode: 'MANY',
      services: [
        {
          query: 'regularização de subleito',
          minQuantidade: 500000,
          unidade: 'm²',
        },
      ],
    });
  });

  it('does not ask for proof-mode clarification when the cumulative default applies', () => {
    const fallback = (service as any).heuristicPlan(
      'Exige pelo menos 500.000 m² de regularização de subleito',
    ) as CapabilityPlan;
    const normalized = (service as any).normalizePlan(
      {
        ...fallback,
        bundleMode: 'ONE',
        needsClarification: 'PROOF_MODE',
        services: [{ query: 'regularização de subleito. Consigo comprovar esse mínimo' }],
      },
      fallback,
    ) as CapabilityPlan;

    expect(normalized.needsClarification).toBeUndefined();
    expect(normalized.bundleMode).toBe('MANY');
    expect(normalized.services).toEqual(fallback.services);
  });

  it('totals converted quantities and returns every contributing atestado', async () => {
    const plan = (service as any).heuristicPlan(
      'O edital pede a imprimação em hectares, mas nossos atestados registram em m². Convertendo, quantos hectares de imprimação a empresa comprova no total?',
    ) as CapabilityPlan;
    expect(plan).toMatchObject({
      operation: 'QUALIFICATION',
      aggregateTotal: true,
      services: [{ query: 'imprimação', unidade: 'hectares' }],
    });
    qualification.findCumulativoAtestados.mockResolvedValue({
      minQuantidade: 0,
      meetsMinimum: true,
      totalQuantidade: 73.5,
      atestados: [
        { atestadoId: 'A1', filename: 'A1.pdf', obraNome: 'Obra 1' },
        { atestadoId: 'A2', filename: 'A2.pdf', obraNome: 'Obra 2' },
      ],
    });

    const output = await (service as any).execute(plan);

    expect(qualification.findCumulativoAtestados).toHaveBeenCalledWith(
      ['imprimação'], 0, 'hectares', undefined,
    );
    expect(output.answer).toContain('73,5 hectares');
    expect(output.sources).toHaveLength(2);
  });

  it('recognizes CBUQ conversion to cubic meters and marks technical conversion as approximate', async () => {
    const plan = (service as any).heuristicPlan(
      'Preciso informar o CBUQ aplicado em m³, e os atestados trazem em toneladas. Considerando a densidade da mistura, a quantos m³ equivale o total?',
    ) as CapabilityPlan;
    expect(plan).toMatchObject({
      operation: 'QUALIFICATION',
      aggregateTotal: true,
      services: [{ query: 'CBUQ aplicado', unidade: 'm³' }],
    });
    qualification.findCumulativoAtestados.mockResolvedValue({
      minQuantidade: 0,
      meetsMinimum: true,
      totalQuantidade: 120,
      atestados: [{
        atestadoId: 'A1', filename: 'A1.pdf', obraNome: 'Obra 1',
        servicos: [{ descricao: 'CBUQ aplicado', conversionKind: 'TECHNICAL' }],
      }],
    });

    const output = await (service as any).execute(plan);

    expect(qualification.findCumulativoAtestados).toHaveBeenCalledWith(
      ['CBUQ aplicado'], 0, 'm³', undefined,
    );
    expect(output.answer).toContain('conversão técnica baseada na densidade');
  });

  it('details the services and quantities in the selected combination', () => {
    const result = {
      fullyQualified: true,
      usedAtestadosCount: 1,
      selectedAtestados: [{
        atestadoId: 'A1', filename: 'A1.pdf', obraNome: 'Obra 1', numeroPrincipal: 'CAT-10',
      }],
      coverageByService: [
        {
          serviceQuery: 'imprimação', covered: true, qualifyingAtestados: [],
          selectedAtestados: [{
            atestadoId: 'A1', filename: 'A1.pdf', obraNome: 'Obra 1',
            servicos: [{ descricao: 'Imprimação', quantidade: 150000, unidade: 'm²' }],
          }],
        },
        {
          serviceQuery: 'CBUQ', covered: true, qualifyingAtestados: [],
          selectedAtestados: [{
            atestadoId: 'A1', filename: 'A1.pdf', obraNome: 'Obra 1',
            servicos: [{ descricao: 'CBUQ', quantidade: 1000, unidade: 't' }],
          }],
        },
      ],
    } as any;

    expect((service as any).summarizeQualification(result)).toContain('Imprimação: 150.000 m²');
    expect((service as any).sourcesFromQualification(result)[0].trecho)
      .toContain('CBUQ: 1.000 t');
  });
});
