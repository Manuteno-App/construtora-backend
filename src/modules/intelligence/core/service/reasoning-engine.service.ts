import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import OpenAI from 'openai';
import { ServiceContextResult } from '../../../extraction/persistence/repository/servico-executado.repository';
import { EXTRACTION_API, IExtractionApi } from '../../../extraction/public-api/interface/extraction-api.interface';
import { ConversationRole } from '../../persistence/entity/conversation-turn.entity';
import { ConversationTurnRepository } from '../../persistence/repository/conversation-turn.repository';
import { HybridRetrieverService, RetrievalFilters, RetrievedChunk } from './hybrid-retriever.service';

const NOT_FOUND_MESSAGE = 'Não encontrei informações sobre isso nos documentos indexados.';

// Token limits per model. Models not listed here are assumed to have a 128k-token context window.
const MODEL_TOKEN_LIMITS: Record<string, number> = {
  'gpt-4': 8192,
  'gpt-4-0613': 8192,
  'gpt-4-32k': 32768,
  'gpt-4-32k-0613': 32768,
  'gpt-4-turbo': 128000,
  'gpt-4-turbo-preview': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-3.5-turbo': 16385,
  'gpt-3.5-turbo-16k': 16385,
};

// Tokens reserved for the system prompt, user query, and completion.
const RESERVED_TOKENS = 2000;
// Conservative chars-per-token estimate for Portuguese text.
const CHARS_PER_TOKEN = 3;

function getMaxContextChars(model: string): number {
  const tokenLimit = MODEL_TOKEN_LIMITS[model] ?? 128000;
  return (tokenLimit - RESERVED_TOKENS) * CHARS_PER_TOKEN;
}

// Fallback model used automatically when the primary model exceeds its context window.
const FALLBACK_CHAT_MODEL = 'gpt-4o';

const SYSTEM_PROMPT = `Você é um assistente especializado em atestados de execução de obras.
Responda SOMENTE com base nos trechos de documentos e nas tabelas de serviços fornecidos abaixo.
Se a informação solicitada não estiver presente no contexto, responda exatamente: "${NOT_FOUND_MESSAGE}"
Não invente dados, valores, datas, nomes ou quantidades.
Ao citar um dado de um trecho de documento ou tabela de serviços, sempre indique a origem no formato [Fonte: <filename>, p.<pagina>].
Cite cada fonte individualmente com seu próprio colchete. Nunca agrupe múltiplas fontes no mesmo colchete com ponto e vírgula.
As seções marcadas com [Fonte: ...] são fontes válidas — use-as para responder.`;

const LISTAGEM_EXTRA_INSTRUCTION = `
Quando a pergunta solicitar QUAIS documentos ou acervos contêm um determinado item ou serviço:
- Responda em UMA ÚNICA frase confirmando quantos documentos foram encontrados com esse item.
- NÃO enumere nem liste os nomes dos documentos no texto da resposta — os links já serão exibidos ao usuário automaticamente.
- Para cada documento, insira apenas a citação inline no formato [Fonte: <filename>, p.<pagina>] — uma por documento, sem agrupar.
- Não repita o nome do documento fora do colchete [Fonte:].`;

type QueryIntent = 'QUANTITATIVO' | 'LISTAGEM' | 'NARRATIVO';

const QUANTITATIVO_KEYWORDS = /total|volume|quantidade|soma|quanto|somar|somatório|somatorio|medição|medicao|metragem|metros|ranking|frequente|maior|recorrente|demandado|acumulado|executado|some|custo|valor|valores|estado|cidade|localidade|piauí|piaui|bahia|ceará|ceara|maranhão|maranhao/i;
const LISTAGEM_KEYWORDS = /quais|liste|listar|enumere|relação de|relação das/i;

export interface SourceRef {
  atestadoId: string;
  filename: string;
  pagina: number;
  trecho: string;
}

export interface QueryDto {
  query: string;
  sessionId?: string;
  filters?: RetrievalFilters & { estado?: string };
}

export interface QueryAnswer {
  answer: string;
  sources: SourceRef[];
  notFound: boolean;
}

@Injectable()
export class ReasoningEngineService {
  private readonly logger = new Logger(ReasoningEngineService.name);
  private readonly openai: OpenAI;
  private readonly similarityThreshold: number;
  private readonly chatModel: string;

  constructor(
    private readonly retriever: HybridRetrieverService,
    @Inject(EXTRACTION_API) private readonly extractionApi: IExtractionApi,
    private readonly config: ConfigService,
    private readonly turnRepo: ConversationTurnRepository,
  ) {
    this.openai = new OpenAI({ apiKey: config.get<string>('openaiApiKey') });
    this.similarityThreshold = config.get<number>('rag.similarityThreshold') ?? 0.35;
    this.chatModel = config.get<string>('chatModel') ?? 'gpt-4o-mini';
  }

  async streamAnswer(dto: QueryDto, res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const emit = (event: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const { notFound, sources, context, intent } = await this.buildContext(dto);

      if (notFound) {
        emit({ type: 'text', content: NOT_FOUND_MESSAGE });
        emit({ type: 'done' });
        await this.persistTurns(dto.query, NOT_FOUND_MESSAGE, dto.sessionId, []);
        res.end();
        return;
      }

      const systemContent = intent === 'LISTAGEM' ? SYSTEM_PROMPT + LISTAGEM_EXTRA_INSTRUCTION : SYSTEM_PROMPT;
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemContent },
        { role: 'user', content: `CONTEXTO:\n${context}\n\nPERGUNTA: ${dto.query}` },
      ];

      let model = this.chatModel;
      const makeStream = (m: string) =>
        this.openai.chat.completions.create({ model: m, stream: true, temperature: 0.1, messages });
      let stream: Awaited<ReturnType<typeof makeStream>>;
      try {
        stream = await makeStream(model);
      } catch (createErr) {
        if (this.isContextLengthError(createErr) && model !== FALLBACK_CHAT_MODEL) {
          this.logger.warn(`Context length exceeded for model "${model}", retrying with fallback model "${FALLBACK_CHAT_MODEL}"`);
          model = FALLBACK_CHAT_MODEL;
          stream = await makeStream(model);
        } else {
          throw createErr;
        }
      }

      let fullResponse = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          fullResponse += delta;
          emit({ type: 'text', content: delta });
        }
      }

      const isNotFound = fullResponse.includes(NOT_FOUND_MESSAGE);
      const dedupedSources = this.deduplicateSources(sources);
      const filteredSources = isNotFound ? [] : (intent === 'LISTAGEM' ? dedupedSources : this.filterSourcesByResponse(dedupedSources, fullResponse));
      emit({ type: 'sources', sources: filteredSources });
      emit({ type: 'done' });

      await this.persistTurns(dto.query, fullResponse, dto.sessionId, filteredSources);
      res.end();
    } catch (err) {
      this.logger.error('Error in streamAnswer', err);
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Internal error' })}\n\n`);
        res.end();
      } catch {
        // response may already be closed
      }
    }
  }

  async answer(dto: QueryDto): Promise<QueryAnswer> {
    const { notFound, sources, context, intent } = await this.buildContext(dto);

    if (notFound) {
      await this.persistTurns(dto.query, NOT_FOUND_MESSAGE, dto.sessionId, []);
      return { answer: NOT_FOUND_MESSAGE, sources: [], notFound: true };
    }

    const systemContent = intent === 'LISTAGEM' ? SYSTEM_PROMPT + LISTAGEM_EXTRA_INSTRUCTION : SYSTEM_PROMPT;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: `CONTEXTO:\n${context}\n\nPERGUNTA: ${dto.query}` },
    ];

    let model = this.chatModel;
    const makeCompletion = (m: string) =>
      this.openai.chat.completions.create({ model: m, stream: false, temperature: 0.1, messages });
    let completion: Awaited<ReturnType<typeof makeCompletion>>;
    try {
      completion = await makeCompletion(model);
    } catch (createErr) {
      if (this.isContextLengthError(createErr) && model !== FALLBACK_CHAT_MODEL) {
        this.logger.warn(`Context length exceeded for model "${model}", retrying with fallback model "${FALLBACK_CHAT_MODEL}"`);
        model = FALLBACK_CHAT_MODEL;
        completion = await makeCompletion(model);
      } else {
        throw createErr;
      }
    }

    const text = completion.choices[0]?.message?.content ?? NOT_FOUND_MESSAGE;
    const isNotFound = text.includes(NOT_FOUND_MESSAGE);
    const dedupedSources = this.deduplicateSources(sources);
    const filteredSources = isNotFound ? [] : (intent === 'LISTAGEM' ? dedupedSources : this.filterSourcesByResponse(dedupedSources, text));
    await this.persistTurns(dto.query, text, dto.sessionId, filteredSources);

    return { answer: text, sources: filteredSources, notFound: isNotFound };
  }

  private async buildContext(dto: QueryDto): Promise<{
    notFound: boolean;
    chunks: RetrievedChunk[];
    sources: SourceRef[];
    context: string;
    intent: QueryIntent;
  }> {
    const intent = this.detectIntent(dto.query);

    // Rewrite query for better retrieval recall, then use it only for retrieval paths.
    // The original query is kept for the LLM prompt and conversation persistence.
    const retrievalQuery = await this.rewriteQueryForRetrieval(dto.query);

    // Run vector/keyword retrieval and direct SQL service search in parallel
    const [chunks, serviceResults] = await Promise.all([
      this.retriever.retrieve(retrievalQuery, dto.filters, intent),
      this.extractionApi.searchServicosForContext(retrievalQuery),
    ]);

    const maxSimilarity = chunks.length > 0 ? Math.max(...chunks.map((c) => c.similarity)) : 0;
    const hasServiceResults = serviceResults.length > 0;

    // Only bail out when BOTH retrieval paths yield nothing
    if (maxSimilarity < this.similarityThreshold && !hasServiceResults) {
      if (chunks.length === 0) {
        this.logger.warn(`NotFound: retriever returned 0 chunks for query: "${dto.query}"`);
      } else {
        this.logger.warn(
          `NotFound: ${chunks.length} chunks found but maxSimilarity=${maxSimilarity.toFixed(3)} < threshold=${this.similarityThreshold}. ` +
          `Top chunks: ${chunks.slice(0, 3).map((c) => `"${c.originalFilename}" p.${c.pageNumber} sim=${Number(c.similarity).toFixed(3)}`).join(' | ')}`,
        );
      }
      return { notFound: true, chunks: [], sources: [], context: '', intent };
    }

    const contextParts: string[] = [];

    // For listing queries, prepend an enumeration of all matching documents as a checklist
    // so the LLM knows about every document before reading the chunks
    if (intent === 'LISTAGEM') {
      const chunkFilenames = maxSimilarity >= this.similarityThreshold
        ? chunks.map((c) => `- ${c.originalFilename} (p.${c.pageNumber})`)
        : [];
      const serviceFilenames = serviceResults
        .reduce<string[]>((acc, r) => (acc.includes(r.filename) ? acc : [...acc, r.filename]), [])
        .map((f) => `- ${f} (p.1)`);
      const allEntries = [...new Set([...chunkFilenames, ...serviceFilenames])];
      if (allEntries.length > 0) {
        contextParts.push(
          `**Documentos encontrados no contexto (${allEntries.length} total — cite TODOS na resposta):**\n${allEntries.join('\n')}`,
        );
      }
    }

    // Add vector/keyword chunks that pass the threshold
    if (maxSimilarity >= this.similarityThreshold && chunks.length > 0) {
      contextParts.push(
        chunks
          .map((c) => `[Fonte: ${c.originalFilename}, p.${c.pageNumber}]\n${c.content}`)
          .join('\n\n---\n\n'),
      );
    }

    // Inject direct SQL service matches as a structured table
    if (hasServiceResults) {
      this.logger.log(`Direct service search found ${serviceResults.length} rows for query: "${dto.query}"`);
      contextParts.push(`\n\n**Serviços encontrados diretamente no banco de dados:**\n${this.buildServiceContextTable(serviceResults)}`);
    }

    if (intent === 'QUANTITATIVO') {
      const localidade = this.extractLocalidadeHint(dto.query);
      const categoria = this.extractCategoriaHint(dto.query);
      const table = await this.extractionApi.getAnalyticsAsMarkdown({ localidade, categoria });
      if (table) contextParts.push(`\n\n**Dados analíticos (SQL):**\n${table}`);
    }

    if (dto.sessionId) {
      const history = await this.turnRepo.findRecentBySessionId(dto.sessionId, 5);
      if (history.length > 0) {
        const historyText = history.map((t) => `${t.role}: ${t.content}`).join('\n');
        contextParts.push(`\n\n**Histórico recente:**\n${historyText}`);
      }
    }

    // Sources: combine chunk sources + service-result sources
    const chunkSources: SourceRef[] = maxSimilarity >= this.similarityThreshold
      ? chunks.map((c) => ({
          atestadoId: c.atestadoId,
          filename: c.originalFilename,
          pagina: c.pageNumber,
          trecho: c.content.slice(0, 200),
        }))
      : [];

    const seenAtestados = new Set<string>(chunkSources.map((s) => s.atestadoId));
    const serviceSources: SourceRef[] = serviceResults
      .filter((r) => !seenAtestados.has(r.atestadoId))
      .reduce<ServiceContextResult[]>((acc, r) => {
        if (!acc.find((x) => x.atestadoId === r.atestadoId)) acc.push(r);
        return acc;
      }, [])
      .map((r) => ({
        atestadoId: r.atestadoId,
        filename: r.filename,
        pagina: 1,
        trecho: `${r.descricao}: ${r.quantidade ?? ''} ${r.unidade ?? ''}`.trim(),
      }));

    const sources: SourceRef[] = [...chunkSources, ...serviceSources];
    const context = this.truncateContext(contextParts.join('\n\n'));

    return { notFound: false, chunks, sources, context, intent };
  }

  private buildServiceContextTable(results: ServiceContextResult[]): string {
    // Group by filename so each atestado becomes its own [Fonte:] block
    const byFile = new Map<string, ServiceContextResult[]>();
    for (const r of results) {
      const list = byFile.get(r.filename) ?? [];
      list.push(r);
      byFile.set(r.filename, list);
    }

    const parts: string[] = [];
    for (const [filename, items] of byFile) {
      const rows = items
        .map((r) => {
          const qty = r.quantidade != null ? ` — ${r.quantidade} ${r.unidade ?? ''}`.trimEnd() : '';
          const cat = r.categoria ? ` [${r.categoria}]` : '';
          return `• ${r.descricao}${qty}${cat}`;
        })
        .join('\n');
      parts.push(`[Fonte: ${filename}, p.1]\nServiços executados neste atestado:\n${rows}`);
    }

    return parts.join('\n\n---\n\n');
  }

  private extractLocalidadeHint(query: string): string | undefined {
    const m = query.match(
      /\b(piauí|piaui|maranhão|maranhao|bahia|ceará|ceara|pará|para|amazonas|tocantins|goiás|goias|minas gerais|são paulo|rio de janeiro|paraná|parana|santa catarina|rio grande do sul|mato grosso|espírito santo|espirito santo|alagoas|sergipe|pernambuco|paraíba|paraiba|rio grande do norte|rondônia|rondonia|acre|roraima|amapá|amapa|mato grosso do sul|df|pi|ma|ba|ce|sp|rj|mg|pr|sc|rs|mt|go|pa|am|to|es|al|se|pe|pb|rn|ro|ac|rr|ap|ms)\b/i,
    );
    return m?.[0];
  }

  private extractCategoriaHint(query: string): string | undefined {
    const m = query.match(
      /\b(terraplenagem|terraplanagem|paviment\w*|drenagem|estrutura|fundação|fundacao|concreto|asfalto|iluminação|iluminacao|saneamento|edificação|edificacao|movimentação|movimentacao)\b/i,
    );
    return m?.[0];
  }

  private isContextLengthError(err: unknown): boolean {
    if (err && typeof err === 'object') {
      const e = err as { status?: number; code?: string; message?: string; error?: { code?: string } };
      const code = e.code ?? (e.error?.code ?? '');
      const msg = e.message ?? '';
      return e.status === 400 && (code === 'context_length_exceeded' || msg.includes('maximum context length'));
    }
    return false;
  }

  private truncateContext(text: string, model?: string): string {
    const maxChars = getMaxContextChars(model ?? this.chatModel);
    if (text.length <= maxChars) return text;
    this.logger.warn(
      `Context truncated from ${text.length} to ${maxChars} chars to stay within model "${model ?? this.chatModel}" token limit`,
    );
    return text.slice(0, maxChars) + '\n\n[... conteúdo truncado por limite de contexto ...]';
  }

  private deduplicateSources(sources: SourceRef[]): SourceRef[] {
    const seen = new Set<string>();
    return sources.filter((s) => {
      const key = `${s.atestadoId}::${s.pagina}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private filterSourcesByResponse(sources: SourceRef[], response: string): SourceRef[] {
    // Parse all [Fonte: ...] brackets, supporting both single and semicolon-grouped citations:
    // [Fonte: file.pdf, p.1]  or  [Fonte: file1.pdf, p.1; file2.pdf, p.1; ...]
    const bracketRe = /\[Fonte:\s*([^\]]+)\]/gi;
    const cited = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = bracketRe.exec(response)) !== null) {
      for (const entry of m[1].split(';')) {
        const fm = entry.trim().match(/^(.+?),\s*p\.\s*\d+/i);
        if (fm) cited.add(fm[1].trim().toLowerCase());
      }
    }
    // No parseable citations → return all sources
    if (cited.size === 0) return sources;
    const matched = sources.filter((s) => cited.has(s.filename.toLowerCase()));
    // If citations were parsed but none matched (e.g. LLM used truncated filename),
    // fall back to all sources to ensure links are always shown.
    return matched.length > 0 ? matched : sources;
  }

  private detectIntent(query: string): QueryIntent {
    if (QUANTITATIVO_KEYWORDS.test(query)) return 'QUANTITATIVO';
    if (LISTAGEM_KEYWORDS.test(query)) return 'LISTAGEM';
    return 'NARRATIVO';
  }

  /**
   * Rewrites the user's natural-language query into technical construction
   * vocabulary to improve vector and keyword retrieval recall.
   * Uses the original query as fallback if the LLM call fails.
   */
  private async rewriteQueryForRetrieval(query: string): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        stream: false,
        temperature: 0,
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content:
              'Você é um especialista em engenharia civil e contratos de obras públicas no Brasil. ' +
              'Reescreva a consulta do usuário usando terminologia técnica de obras (terraplenagem, ' +
              'pavimentação, drenagem, estruturas, etc.) e expandindo abreviações e siglas de estados. ' +
              'Mantenha o significado original. Responda APENAS com a consulta reescrita, sem explicações.',
          },
          { role: 'user', content: query },
        ],
      });
      const rewritten = completion.choices[0]?.message?.content?.trim();
      if (rewritten && rewritten.length > 0) {
        this.logger.log(`Query rewrite: "${query}" → "${rewritten}"`);
        return rewritten;
      }
    } catch (err) {
      this.logger.warn(`Query rewrite failed, using original: ${err}`);
    }
    return query;
  }

  private async persistTurns(
    userQuery: string,
    assistantResponse: string,
    sessionId: string | undefined,
    sources: SourceRef[],
  ): Promise<void> {
    if (!sessionId) return;
    await this.turnRepo.saveTurn({
      sessionId,
      role: ConversationRole.USER,
      content: userQuery,
    });
    await this.turnRepo.saveTurn({
      sessionId,
      role: ConversationRole.ASSISTANT,
      content: assistantResponse,
      sources: sources as unknown as Record<string, unknown>[],
    });
  }
}
