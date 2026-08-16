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

export type ChatOperation = 'QUALIFICATION' | 'INVENTORY' | 'REGIONAL_EXPERIENCE' | 'TECHNICAL_EXPERIENCE' | 'NARRATIVE';

export interface CapabilityPlan {
  operation: ChatOperation;
  services: Array<{ query: string; minQuantidade?: number; unidade?: string }>;
  aggregateTotal?: boolean;
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
              required: ['operation', 'services', 'aggregateTotal', 'bundleMode', 'maxAtestados', 'filters', 'state', 'technicalArea', 'needsClarification'],
              properties: {
                operation: { type: 'string', enum: ['QUALIFICATION', 'INVENTORY', 'REGIONAL_EXPERIENCE', 'TECHNICAL_EXPERIENCE', 'NARRATIVE'] },
                services: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['query', 'minQuantidade', 'unidade'], properties: { query: { type: 'string' }, minQuantidade: { type: ['number', 'null'] }, unidade: { type: ['string', 'null'] } } } },
                aggregateTotal: { type: ['boolean', 'null'] },
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
          { role: 'system', content: 'Converta perguntas sobre acervo técnico em JSON. Não crie SQL. A propriedade services[].query DEVE conter somente o nome técnico do serviço, material ou atividade pesquisada — nunca copie a pergunta, verbos de intenção, quantidade, edital ou referência a atestados. Exemplo: para "Preciso de 2 atestados juntos que provem Regularização do sub-leito", use query="Regularização do sub-leito", operation="QUALIFICATION", bundleMode="MAX" e maxAtestados=2. QUALIFICATION é exclusivamente para verificar se o acervo atende a uma exigência (edital, mínimo, comprovação). INVENTORY é para consultas descritivas ao acervo, como "quais atestados têm CBUQ e em qual quantidade?"; nessas consultas extraia o serviço e não infira mínimo, edital ou não atendimento. REGIONAL_EXPERIENCE é para estado/órgão; TECHNICAL_EXPERIENCE para engenheiro/responsável; NARRATIVE para demais perguntas. Use MANY como padrão para somatório. Para perguntas de total convertido sem mínimo (ex.: quantos hectares), defina aggregateTotal=true e informe a unidade de destino no serviço. Só peça esclarecimento se a ausência impedir cálculo.' },
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
    const max = query.match(/(?:no m[aá]ximo|at[eé]|preciso\s+de)\s+(\d+)\s+atestados?(?:\s+juntos?)?/i);
    const quantity = query.match(/(?:m[ií]nimo(?:\s+de)?|pelo menos|exige|exigência(?:\s+de)?|\bde\s+)\s*(\d+(?:[.]\d+)*(?:,\d+)?(?:\s+mil)?)\s*(m²|m³|m2|m3|metros?|m\b|ha|hectares?|toneladas?|t\b|km)?/i);
    const minQuantidade = quantity ? this.parseQuantity(quantity[1]) : undefined;
    const unidade = this.normalizeUnit(quantity?.[2]);
    // Quantitative questions frequently include a second sentence such as
    // "Consigo comprovar?". That sentence is not part of the service name and
    // makes the full-text service search unnecessarily restrictive.
    const requirementSentence = query.split(/(?<=[a-zA-Z²³])\s*[.?!]\s*/)[0];
    const aggregateTotal = /\b(?:quantos?|total|convertendo|converter)\b/i.test(query);
    const inventory = this.isInventoryQuery(query) || this.isBareServiceQuery(query);
    const targetUnit = query.match(/\bem\s+(hectares?|ha|m²|m2|m³|m3|km|toneladas?)(?![a-z])/i)?.[1]
      ?.replace(/m2/i, 'm²').replace(/m3/i, 'm³');
    const convertedService = requirementSentence
      .match(/\b(?:de|o|a)\s+(.+?)\s+em\s+(?:hectares?|ha|m²|m2|m³|m3|km|toneladas?)(?![a-z])/i)?.[1]
      ?.replace(/^(?:edital\s+pede\s+(?:a|o)\s+|preciso\s+informar\s+(?:o|a)\s+)/i, '')
      .split(/\s*,\s*/)[0]
      .trim();
    const requirementService = requirementSentence.match(/\b(?:provem|comprovem|comprovar|tenham|possuam)\s+(.+?)(?:[?!.]|$)/i)?.[1]?.trim();
    const service = (requirementService ?? requirementSentence)
      .replace(/.*?(?:m[ií]nimo(?:\s+de)?|pelo menos|exige|exigência(?:\s+de)?)\s*\d+(?:[.]\d+)*(?:,\d+)?(?:\s+mil)?\s*(?:m²|m³|m2|m3|metros?|m\b|ha|hectares?|toneladas?|t\b|km)?\s*(?:de\s*)?/i, '')
      .trim();
    const inventoryService = this.extractInventoryService(query) ?? (this.isBareServiceQuery(query) ? query.trim() : undefined);
    const requiresSingleAtestado = /(?:em|num|no)\s+(?:um|único)\s+atestado/i.test(query);
    return {
      operation: regional ? 'REGIONAL_EXPERIENCE' : technical ? 'TECHNICAL_EXPERIENCE' : inventory ? 'INVENTORY' : Boolean(max) || aggregateTotal || minQuantidade || /comprovar|provem|comprovem|atende/i.test(query) ? 'QUALIFICATION' : 'NARRATIVE',
      services: (inventory ? inventoryService : aggregateTotal ? convertedService : service) ? [{ query: inventory ? inventoryService! : aggregateTotal ? convertedService! : service, minQuantidade: inventory ? undefined : minQuantidade, unidade: aggregateTotal ? targetUnit : unidade }] : [],
      aggregateTotal: inventory ? false : aggregateTotal,
      // When the edital does not constrain the number of documents, assess the
      // available acervo cumulatively. This is also the Chat's documented
      // default, and avoids discarding partial certificates.
      bundleMode: max ? 'MAX' : requiresSingleAtestado ? 'ONE' : 'MANY',
      maxAtestados: max ? Number(max[1]) : undefined,
      state: regional ? this.extractState(query) : undefined,
      technicalArea: technical ? 'pavimentação asfáltica' : undefined,
    };
  }

  private normalizePlan(plan: CapabilityPlan, fallback: CapabilityPlan): CapabilityPlan {
    const services = (plan.services ?? []).filter((service) => this.isSemanticServiceQuery(service.query)).map((service) => ({
      query: service.query.trim(), minQuantidade: service.minQuantidade ?? undefined, unidade: service.unidade ?? undefined,
    }));
    const filters = plan.filters ? Object.fromEntries(Object.entries(plan.filters).filter(([, value]) => value != null)) as QualificationFilters : undefined;
    const shouldUseCumulativeDefault =
      fallback.operation === 'QUALIFICATION' &&
      fallback.bundleMode === 'MANY' &&
      fallback.services.some((service) => service.minQuantidade !== undefined);
    const useFallbackRequirement =
      shouldUseCumulativeDefault && fallback.services.length === 1;
    const useFallbackAggregate = fallback.aggregateTotal && fallback.services.length === 1;
    return {
      ...fallback,
      ...plan,
      // General lookup questions must never be transformed into an edital
      // evaluation just because they mention an atestado or a quantity.
      operation: fallback.operation === 'INVENTORY' ? 'INVENTORY' : plan.operation,
      filters,
      // For a single, explicit numeric criterion the deterministic parser is
      // more reliable than a generative paraphrase (which may include the
      // surrounding conversational question in the service text).
      services: fallback.operation === 'INVENTORY' || useFallbackRequirement || useFallbackAggregate
        ? fallback.services
        : services.length
          ? services
          : fallback.services,
      bundleMode: shouldUseCumulativeDefault
        ? 'MANY'
        : plan.bundleMode ?? fallback.bundleMode,
      maxAtestados: plan.maxAtestados ?? fallback.maxAtestados,
      // A missing proof-mode rule does not block the calculation: MANY is the
      // documented default. Keep the conversation moving instead of returning
      // an avoidable clarification for an otherwise complete requirement.
      needsClarification:
        shouldUseCumulativeDefault && plan.needsClarification === 'PROOF_MODE'
          ? undefined
          : plan.needsClarification ?? undefined,
      aggregateTotal: fallback.operation === 'INVENTORY' ? false : useFallbackAggregate ? true : plan.aggregateTotal ?? false,
    };
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
      if (plan.aggregateTotal) return this.aggregateQualificationTotal(services[0], plan.filters);
      const request: BundleEvaluationRequest = { bundleMode: plan.bundleMode ?? 'MANY', ...(plan.bundleMode === 'MAX' ? { maxAtestados: plan.maxAtestados ?? 1 } : {}), services, filters: plan.filters };
      return { result: await this.qualification.evaluateBundlePolicy(request) };
    }
    if (plan.operation === 'REGIONAL_EXPERIENCE') return this.regionalExperience(plan.state);
    if (plan.operation === 'TECHNICAL_EXPERIENCE') return this.technicalExperience(plan.technicalArea);
    if (plan.operation === 'INVENTORY') return this.inventoryExperience(plan.services[0]?.query);
    return { answer: 'Reformule indicando o serviço, quantidade, unidade ou obra que deseja analisar.', sources: [] };
  }

  private async inventoryExperience(service?: string): Promise<{ answer: string; sources: CapabilitySource[] }> {
    if (!service) return { answer: 'Informe o serviço ou material que deseja consultar no acervo.', sources: [] };
    const rows = await this.dataSource.query<Array<{
      atestadoId: string; filename: string; descricao: string; quantidade: string | number | null; unidade: string | null; obra: string | null;
    }>>(
      `SELECT s.atestado_id AS "atestadoId", a.original_filename AS filename, s.descricao,
              s.quantidade, s.unidade, o.nome AS obra
         FROM servicos_executados s
         JOIN atestados a ON a.id = s.atestado_id
         LEFT JOIN obras o ON o.id = s.obra_id
        WHERE a.status = 'DONE' AND UPPER(s.descricao) LIKE UPPER($1)
        ORDER BY a.original_filename, s.descricao
        LIMIT 100`,
      [`%${service}%`],
    );
    if (!rows.length) return { answer: `Não encontrei serviços com ${service} no acervo indexado.`, sources: [] };

    const formatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
    const answer = `Encontrei ${rows.length} registro(s) de ${service} em ${new Set(rows.map((row) => row.atestadoId)).size} atestado(s): ${rows.map((row) => {
      const quantity = row.quantidade === null ? 'quantidade não informada' : `${formatter.format(Number(row.quantidade))} ${row.unidade ?? ''}`.trim();
      return `${row.descricao} — ${quantity} (${row.filename})`;
    }).join('; ')}.`;
    return {
      answer,
      sources: rows.map((row) => ({ atestadoId: row.atestadoId, filename: row.filename, pagina: 1, trecho: `${row.descricao}${row.obra ? ` — ${row.obra}` : ''}` })),
    };
  }

  private isInventoryQuery(query: string): boolean {
    const lower = query.toLowerCase();
    const asksForDocuments = /\b(?:quais?|listar|liste|mostre|exiba|onde|tem|possui|possuem|quantidade|quantidades)\b/.test(lower) && /\b(?:atestado|atestados|acervo)\b/.test(lower);
    const asksForQuantity = /\b(?:qual(?:\s+é)?|quantos?|quanto|listar|mostre)\b/.test(lower) && /\b(?:quantidade|quantitativo|total)\b/.test(lower);
    const isRequirement = /\b(?:edital|exige|exigência|requisito|mínimo|pelo menos|comprovar|atende|atender|preciso)\b/.test(lower);
    return (asksForDocuments || asksForQuantity) && !isRequirement;
  }

  private isSemanticServiceQuery(query: string | undefined): boolean {
    if (!query?.trim()) return false;
    // This is deliberately a validation guard, not an attempt to enumerate
    // Portuguese phrasings. The model remains responsible for extraction.
    return !/\b(?:preciso|quero|liste|listar|atestado|atestados|acervo|edital|prove|provem|comprove|comprovem|quantos?|quanto|atende)\b/i.test(query);
  }

  private isBareServiceQuery(query: string): boolean {
    const value = query.trim();
    if (!value || /[?!]/.test(value)) return false;
    if (/\b(?:ol[aá]|oi|bom dia|boa tarde|boa noite|ajuda|obrigad[oa])\b/i.test(value)) return false;
    const words = value.split(/\s+/);
    return words.length <= 6 && words.some((word) => word.replace(/[^\p{L}\p{N}]/gu, '').length >= 4);
  }

  private extractInventoryService(query: string): string | undefined {
    const match = query.match(/\b(?:tem|têm|possui|possuem|com|de)\s+(.+?)(?:\s+e\s+em\s+qual(?:\s+quantidade)?|\s+em\s+qual(?:\s+quantidade)?|[?!.]|$)/i)
      ?? query.match(/\b(?:quantidade|quantitativo|total)\s+(?:de|do|da)\s+(.+?)(?:[?!.]|$)/i);
    const candidate = match?.[1]
      ?.replace(/\b(?:atestado|atestados|acervo)\b/gi, '')
      .trim();
    return candidate && candidate.length >= 2 ? candidate : undefined;
  }

  private parseQuantity(value: string): number {
    const normalized = value.trim().toLowerCase();
    if (normalized.endsWith(' mil')) return Number(normalized.slice(0, -4).replace('.', '').replace(',', '.')) * 1000;
    return Number(normalized.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  }

  private normalizeUnit(unit?: string): string | undefined {
    if (!unit) return undefined;
    if (/^m2$/i.test(unit)) return 'm²';
    if (/^m3$/i.test(unit)) return 'm³';
    if (/^metros?$/i.test(unit)) return 'm';
    return unit;
  }

  private async aggregateQualificationTotal(service: ServiceRequirement, filters?: QualificationFilters): Promise<{ answer: string; sources: CapabilitySource[] }> {
    const cumulative = await this.qualification.findCumulativoAtestados(
      [service.query],
      0,
      service.unidade,
      filters,
    );
    if (!cumulative.atestados.length) {
      return { answer: `Não encontrei atestados com ${service.query} para totalizar.`, sources: [] };
    }
    const unit = service.unidade ?? 'na unidade registrada';
    const total = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(cumulative.totalQuantidade);
    const usesTechnicalConversion = cumulative.atestados.some((source) =>
      source.servicos?.some((item) => item.conversionKind === 'TECHNICAL'),
    );
    const unavailableConversions = cumulative.atestados.flatMap((source) => source.servicos ?? [])
      .filter((item) => item.conversionUnavailableReason).length;
    const conversionNote = usesTechnicalConversion
      ? ' O valor é aproximado, pois usa uma conversão técnica baseada na densidade da mistura.'
      : '';
    const unavailableNote = unavailableConversions
      ? ` ${unavailableConversions} item(ns) sem regra de conversão aprovada não foram incluídos no total.`
      : '';
    return {
      answer: `A empresa comprova ${total} ${unit} de ${service.query} no total, em ${cumulative.atestados.length} atestado(s). Veja os documentos abaixo.${conversionNote}${unavailableNote}`,
      sources: cumulative.atestados.map((source) => ({ atestadoId: source.atestadoId, filename: source.filename, pagina: source.servicos?.find((item) => item.pageNumber)?.pageNumber ?? 1, trecho: source.obraNome })),
    };
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
    if (result.fullyQualified) {
      const combination = this.describeSelectedAtestados(result)
        .map((item) => `${item.filename}: ${item.trecho}`)
        .join('; ');
      return `Atende aos requisitos com ${result.usedAtestadosCount} atestado(s). Melhor combinação: ${combination}.`;
    }
    const failures = result.coverageByService.filter((item) => !item.qualified).map((item) => item.serviceQuery);
    return `O acervo não atende integralmente aos requisitos${failures.length ? ` para: ${failures.join(', ')}` : ''}. Veja os quantitativos e documentos disponíveis abaixo.`;
  }

  private sourcesFromQualification(result: BundleEvaluationResult): CapabilitySource[] {
    return this.describeSelectedAtestados(result);
  }

  private describeSelectedAtestados(result: BundleEvaluationResult): CapabilitySource[] {
    const seen = new Set<string>();
    return result.selectedAtestados
      .filter((source) => !seen.has(source.atestadoId) && Boolean(seen.add(source.atestadoId)))
      .map((source) => {
        const coverage = result.coverageByService.flatMap((criterion) => {
          const selected = criterion.selectedAtestados?.find((item) => item.atestadoId === source.atestadoId);
          if (!selected) return [];
          const quantities = (selected.servicos ?? []).map((item) => {
            const quantity = item.quantidadeConvertida ?? item.quantidade;
            const formatted = quantity === undefined
              ? item.descricao
              : `${item.descricao}: ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(quantity)} ${item.unidadeComparada ?? item.unidade ?? ''}`.trim();
            return formatted;
          });
          return quantities.length ? quantities : [criterion.serviceQuery];
        });
        const identifier = source.numeroPrincipal ? `Atestado ${source.numeroPrincipal}` : undefined;
        const context = [identifier, source.obraNome, ...coverage].filter(Boolean).join(' — ');
        return {
          atestadoId: source.atestadoId,
          filename: source.filename,
          pagina: source.servicos?.find((item) => item.pageNumber)?.pageNumber ?? 1,
          trecho: context || source.obraNome,
        };
      });
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
