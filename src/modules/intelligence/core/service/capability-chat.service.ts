import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import OpenAI from 'openai';
import {
  BundleEvaluationRequest,
  BundleEvaluationResult,
  IQualificationApi,
  QUALIFICATION_API,
  QualificationFilters,
  ServiceRequirement,
} from '../../../qualification/public-api/interface/qualification-api.interface';
import { ConversationRole } from '../../persistence/entity/conversation-turn.entity';
import { ConversationTurnRepository } from '../../persistence/repository/conversation-turn.repository';

export type ChatOperation = 'QUALIFICATION' | 'REGIONAL_EXPERIENCE' | 'TECHNICAL_EXPERIENCE' | 'NARRATIVE';

export interface CapabilityPlan {
  operation: ChatOperation;
  services: Array<{ query: string; minQuantidade?: number; unidade?: string }>;
  bundleMode?: 'ONE' | 'MANY' | 'MAX';
  maxAtestados?: number;
  filters?: QualificationFilters;
  state?: string;
  technicalArea?: string;
  needsClarification?: 'UNIT' | 'PROOF_MODE' | 'TECHNICAL_CONVERSION';
}

export interface CapabilitySource {
  atestadoId: string;
  filename: string;
  pagina?: number;
  trecho?: string;
}

export interface CapabilityAnswer {
  answer: string;
  result?: BundleEvaluationResult;
  sources: CapabilitySource[];
  plan: CapabilityPlan;
}

@Injectable()
export class CapabilityChatService {
  private readonly logger = new Logger(CapabilityChatService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    @Inject(QUALIFICATION_API) private readonly qualification: IQualificationApi,
    private readonly turns: ConversationTurnRepository,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    this.openai = new OpenAI({ apiKey: config.get<string>('openaiApiKey') });
    this.model = config.get<string>('chatModel') ?? 'gpt-4o-mini';
  }

  async answer(input: { query: string; sessionId?: string; clarification?: { turnId: string; value: string } }): Promise<CapabilityAnswer | { clarification: { question: string; field: string; turnId?: string }; plan: CapabilityPlan }> {
    const query = input.query.trim();
    const plan = input.clarification
      ? await this.resumePlan(input.clarification, query)
      : await this.plan(query);

    if (plan.needsClarification) {
      const question = this.clarificationQuestion(plan.needsClarification);
      const turn = input.sessionId
        ? await this.turns.saveTurn({
            sessionId: input.sessionId,
            role: ConversationRole.ASSISTANT,
            content: question,
            metadata: { kind: 'CLARIFICATION', plan },
          })
        : undefined;
      return { clarification: { question, field: plan.needsClarification, turnId: turn?.id }, plan };
    }

    const result = await this.execute(plan);
    if ('result' in result) {
      const answer = this.summarizeQualification(result.result);
      const sources = this.sourcesFromQualification(result.result);
      await this.persist(input.sessionId, query, answer, sources, { kind: 'CAPABILITY', plan, result: result.result });
      return { answer, result: result.result, sources, plan };
    }

    await this.persist(input.sessionId, query, result.answer, result.sources, { kind: 'CAPABILITY', plan });
    return { answer: result.answer, sources: result.sources, plan };
  }

  private async plan(query: string): Promise<CapabilityPlan> {
    const fallback = this.heuristicPlan(query);
    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'capability_query_plan',
            strict: true,
            schema: {
              type: 'object', additionalProperties: false,
              required: ['operation', 'services', 'bundleMode', 'maxAtestados', 'filters', 'state', 'technicalArea', 'needsClarification'],
              properties: {
                operation: { type: 'string', enum: ['QUALIFICATION', 'REGIONAL_EXPERIENCE', 'TECHNICAL_EXPERIENCE', 'NARRATIVE'] },
                services: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['query', 'minQuantidade', 'unidade'], properties: { query: { type: 'string' }, minQuantidade: { type: ['number', 'null'] }, unidade: { type: ['string', 'null'] } } } },
                bundleMode: { type: ['string', 'null'], enum: ['ONE', 'MANY', 'MAX', null] },
                maxAtestados: { type: ['number', 'null'] },
                filters: {
                  type: ['object', 'null'],
                  additionalProperties: false,
                  required: ['dataInicio', 'dataFim', 'localidade', 'minValor', 'extensaoKm', 'categoriaAtestado'],
                  properties: {
                    dataInicio: { type: ['string', 'null'] }, dataFim: { type: ['string', 'null'] }, localidade: { type: ['string', 'null'] },
                    minValor: { type: ['number', 'null'] }, extensaoKm: { type: ['number', 'null'] }, categoriaAtestado: { type: ['string', 'null'], enum: ['ST', 'CIV', 'SAN', 'INS', null] },
                  },
                },
                state: { type: ['string', 'null'] },
                technicalArea: { type: ['string', 'null'] },
                needsClarification: { type: ['string', 'null'], enum: ['UNIT', 'PROOF_MODE', 'TECHNICAL_CONVERSION', null] },
              },
            },
          },
        } as never,
        messages: [
          { role: 'system', content: 'Converta perguntas sobre acervo técnico em JSON. Não crie SQL. QUALIFICATION é para comprovar quantidade/combinação; REGIONAL_EXPERIENCE para estado/órgão; TECHNICAL_EXPERIENCE para engenheiro/responsável; NARRATIVE para demais perguntas. Use MANY como padrão para somatório. Só peça esclarecimento se a ausência impedir cálculo.' },
          { role: 'user', content: query },
        ],
      });
      const raw = completion.choices[0]?.message.content;
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as CapabilityPlan;
      return this.normalizePlan(parsed, fallback);
    } catch (error) {
      this.logger.warn(`Structured plan failed; using conservative parser: ${(error as Error).message}`);
      return fallback;
    }
  }

  private heuristicPlan(query: string): CapabilityPlan {
    const lower = query.toLowerCase();
    const regional = /\b(estado|para[ií]ba|piau[ií]|bahia|cear[aá]|maranh[aã]o|regional)\b/.test(lower);
    const technical = /respons[aá]vel t[eé]cnico|engenheir|acervo.*pavimenta/.test(lower);
    const max = query.match(/(?:no m[aá]ximo|at[eé])\s+(\d+)\s+atestados?/i);
    const quantity = query.match(/(?:m[ií]nimo(?:\s+de)?|pelo menos|\bde\s+)\s*([\d.]+(?:,\d+)?)\s*(m²|m³|m2|m3|ha|hectares?|toneladas?|t\b|km)?/i);
    const minQuantidade = quantity ? Number(quantity[1].replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')) : undefined;
    const unidade = quantity?.[2]?.replace(/m2/i, 'm²').replace(/m3/i, 'm³');
    const service = query
      .replace(/.*?(?:m[ií]nimo(?:\s+de)?|pelo menos)\s*[\d.,]+\s*(?:m²|m³|m2|m3|ha|hectares?|toneladas?|t\b)?\s*(?:de\s*)?/i, '')
      .replace(/[?.].*$/, '').trim();
    return {
      operation: regional ? 'REGIONAL_EXPERIENCE' : technical ? 'TECHNICAL_EXPERIENCE' : minQuantidade || /comprovar|atende|atestados?/i.test(query) ? 'QUALIFICATION' : 'NARRATIVE',
      services: service ? [{ query: service, minQuantidade, unidade }] : [],
      bundleMode: max ? 'MAX' : /somando|somat[oó]rio|total|acervo/i.test(lower) ? 'MANY' : 'ONE',
      maxAtestados: max ? Number(max[1]) : undefined,
      state: regional ? this.extractState(query) : undefined,
      technicalArea: technical ? 'pavimentação asfáltica' : undefined,
    };
  }

  private normalizePlan(plan: CapabilityPlan, fallback: CapabilityPlan): CapabilityPlan {
    const services = (plan.services ?? []).filter((service) => service.query?.trim()).map((service) => ({
      query: service.query.trim(), minQuantidade: service.minQuantidade ?? undefined, unidade: service.unidade ?? undefined,
    }));
    const filters = plan.filters ? Object.fromEntries(Object.entries(plan.filters).filter(([, value]) => value != null)) as QualificationFilters : undefined;
    return { ...fallback, ...plan, filters, services: services.length ? services : fallback.services, bundleMode: plan.bundleMode ?? fallback.bundleMode };
  }

  private async resumePlan(clarification: { turnId: string; value: string }, query: string): Promise<CapabilityPlan> {
    const turn = await this.turns.findById(clarification.turnId);
    const plan = turn?.metadata?.plan as CapabilityPlan | undefined;
    if (!plan) return this.plan(query);
    const value = clarification.value.trim();
    if (plan.needsClarification === 'PROOF_MODE') {
      return { ...plan, bundleMode: /único|one/i.test(value) ? 'ONE' : /m[aá]ximo|at[eé]/i.test(value) ? 'MAX' : 'MANY', needsClarification: undefined };
    }
    if (plan.needsClarification === 'UNIT') {
      return { ...plan, services: plan.services.map((service) => ({ ...service, unidade: value })), needsClarification: undefined };
    }
    // Technical factors are intentionally not persisted. The response remains caveated until an approved rule exists.
    return { ...plan, needsClarification: undefined };
  }

  private clarificationQuestion(kind: NonNullable<CapabilityPlan['needsClarification']>): string {
    if (kind === 'UNIT') return 'Qual unidade o edital exige para essa quantidade?';
    if (kind === 'PROOF_MODE') return 'A comprovação pode ser por somatório de atestados, deve estar em um único atestado ou há um limite máximo de documentos?';
    return 'Não existe uma conversão técnica aprovada para essas unidades. Informe o fator técnico a usar nesta análise (ele será marcado como aproximado).';
  }

  private async execute(plan: CapabilityPlan): Promise<{ result: BundleEvaluationResult } | { answer: string; sources: CapabilitySource[] }> {
    if (plan.operation === 'QUALIFICATION') {
      const services: ServiceRequirement[] = plan.services;
      if (!services.length) return { answer: 'Preciso do serviço ou material que deve ser comprovado.', sources: [] };
      const request: BundleEvaluationRequest = { bundleMode: plan.bundleMode ?? 'MANY', ...(plan.bundleMode === 'MAX' ? { maxAtestados: plan.maxAtestados ?? 1 } : {}), services, filters: plan.filters };
      return { result: await this.qualification.evaluateBundlePolicy(request) };
    }
    if (plan.operation === 'REGIONAL_EXPERIENCE') return this.regionalExperience(plan.state);
    if (plan.operation === 'TECHNICAL_EXPERIENCE') return this.technicalExperience(plan.technicalArea);
    return { answer: 'Reformule indicando o serviço, quantidade, unidade ou obra que deseja analisar.', sources: [] };
  }

  private async regionalExperience(state?: string): Promise<{ answer: string; sources: CapabilitySource[] }> {
    if (!state) return { answer: 'Qual estado deve ser considerado na experiência regional?', sources: [] };
    const rows = await this.dataSource.query<Array<{ id: string; filename: string; obra: string; local: string | null; cliente: string | null }>>(
      `SELECT DISTINCT a.id, a.original_filename AS filename, o.nome AS obra, o.local, o.cliente FROM obras o JOIN atestados a ON a.id = o.atestado_id WHERE a.status = 'DONE' AND (UPPER(COALESCE(o.estado, '')) = UPPER($1) OR UPPER(COALESCE(o.local, '')) LIKE UPPER($2)) ORDER BY o.nome`,
      [state, `%${state}%`],
    );
    if (!rows.length) return { answer: `Não encontrei obras executadas em ${state} no acervo indexado.`, sources: [] };
    return { answer: `Encontrei ${rows.length} obra(s) em ${state}: ${rows.map((row) => `${row.obra}${row.cliente ? ` — órgão/cliente: ${row.cliente}` : ''}`).join('; ')}.`, sources: rows.map((row) => ({ atestadoId: row.id, filename: row.filename, pagina: 1, trecho: row.obra })) };
  }

  private async technicalExperience(area?: string): Promise<{ answer: string; sources: CapabilitySource[] }> {
    const term = area ?? 'pavimentação';
    const rows = await this.dataSource.query<Array<{ id: string; filename: string; engenheiro: string; obra: string }>>(
      `SELECT DISTINCT a.id, a.original_filename AS filename, o.engenheiro, o.nome AS obra FROM obras o JOIN atestados a ON a.id = o.atestado_id JOIN servicos_executados s ON s.obra_id = o.id WHERE a.status = 'DONE' AND o.engenheiro IS NOT NULL AND UPPER(s.descricao) LIKE UPPER($1) ORDER BY o.engenheiro, o.nome`,
      [`%${term}%`],
    );
    if (!rows.length) return { answer: `Não encontrei responsável técnico com serviço de ${term} vinculado no acervo.`, sources: [] };
    return { answer: `Responsáveis técnicos encontrados: ${rows.map((row) => `${row.engenheiro} (${row.obra})`).join('; ')}.`, sources: rows.map((row) => ({ atestadoId: row.id, filename: row.filename, pagina: 1, trecho: `${row.engenheiro} — ${row.obra}` })) };
  }

  private summarizeQualification(result: BundleEvaluationResult): string {
    if (result.fullyQualified) return `Atende aos requisitos com ${result.usedAtestadosCount} atestado(s). Veja a cobertura e os documentos selecionados abaixo.`;
    const failures = result.coverageByService.filter((item) => !item.qualified).map((item) => item.serviceQuery);
    return `O acervo não atende integralmente aos requisitos${failures.length ? ` para: ${failures.join(', ')}` : ''}. Veja os quantitativos e documentos disponíveis abaixo.`;
  }

  private sourcesFromQualification(result: BundleEvaluationResult): CapabilitySource[] {
    const seen = new Set<string>();
    return result.selectedAtestados.filter((source) => !seen.has(source.atestadoId) && Boolean(seen.add(source.atestadoId))).map((source) => ({ atestadoId: source.atestadoId, filename: source.filename, pagina: source.servicos?.find((item) => item.pageNumber)?.pageNumber ?? 1, trecho: source.obraNome }));
  }

  private async persist(sessionId: string | undefined, query: string, answer: string, sources: CapabilitySource[], metadata: Record<string, unknown>): Promise<void> {
    if (!sessionId) return;
    await this.turns.saveTurn({ sessionId, role: ConversationRole.USER, content: query });
    await this.turns.saveTurn({ sessionId, role: ConversationRole.ASSISTANT, content: answer, sources: sources as unknown as Record<string, unknown>[], metadata });
  }

  private extractState(query: string): string | undefined {
    const match = query.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO|Para[ií]ba|Piau[ií]|Bahia|Cear[aá]|Maranh[aã]o)\b/i);
    return match?.[0];
  }
}
