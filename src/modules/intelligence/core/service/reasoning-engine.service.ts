import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import OpenAI from 'openai';
import { ServiceContextResult } from '../../../extraction/persistence/repository/servico-executado.repository';
import { EXTRACTION_API, IExtractionApi, ServicoFilter } from '../../../extraction/public-api/interface/extraction-api.interface';
import { QualificationService } from '../../../qualification/core/service/qualification.service';
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

type QueryIntent = 'QUANTITATIVO' | 'LISTAGEM' | 'NARRATIVO' | 'COMPROVACAO' | 'BUNDLE_SINGLE' | 'BUNDLE_CUMULATIVE';

const BUNDLE_SINGLE_KEYWORDS = /um\s+único\s+atestado|atestado\s+único|único\s+atestado\s+que|atestado\s+individual\s+por/i;
const BUNDLE_CUMULATIVE_KEYWORDS = /somatório\s+de\s+atestados|soma\s+de\s+atestados|conjunto\s+de\s+atestados|atestados\s+acumulados|acervo\s+cumulativo/i;
const COMPROVACAO_KEYWORDS = /comprov[ae]|comprovação|comprovacao|demonstr[ae]|qualificação|qualificacao|habilit[ae]|habilitação|habilitacao|atesta que|acervo técnico|acervo tecnico/i;
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
    private readonly qualificationService: QualificationService,
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
      // COMPROVACAO/BUNDLE: always expose all retrieved sources — the LLM summarises requirements
      // without citing every [Fonte:] bracket, so response-filtering would drop valid sources.
      // All other intents: filter by citations so the sources panel matches what the LLM cited.
      const isComprovacaoLike = intent === 'COMPROVACAO' || intent === 'BUNDLE_SINGLE' || intent === 'BUNDLE_CUMULATIVE';
      const filteredSources = isNotFound ? [] : isComprovacaoLike ? dedupedSources : this.filterSourcesByResponse(dedupedSources, fullResponse);
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
    // COMPROVACAO/BUNDLE: always expose all retrieved sources.
    // All other intents: filter by citations so the sources panel matches what the LLM cited.
    const isComprovacaoLike = intent === 'COMPROVACAO' || intent === 'BUNDLE_SINGLE' || intent === 'BUNDLE_CUMULATIVE';
    const filteredSources = isNotFound ? [] : isComprovacaoLike ? dedupedSources : this.filterSourcesByResponse(dedupedSources, text);
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

    // Extract minimum-quantity hint so the SQL call can run in parallel with vector retrieval
    const qtyHint = this.extractQuantidadeMinima(dto.query);

    // Extract obra-level filters (localidades, minValor, tipo) for state/value queries
    const localidades = this.extractLocalidades(dto.query);
    const minValor = this.extractMinValor(dto.query);
    const tipoObra = this.extractTipoObra(dto.query);
    const hasObraFilter = localidades.length > 0 || minValor !== undefined || tipoObra !== undefined;

    // For COMPROVACAO/BUNDLE queries, extract services via LLM before running SQL (can't parallelize)
    let servicosFiltros: ServicoFilter[] = [];
    if (intent === 'COMPROVACAO' || intent === 'BUNDLE_SINGLE' || intent === 'BUNDLE_CUMULATIVE') {
      servicosFiltros = await this.extractServicosComQuantidades(dto.query);
      this.logger.log(`${intent}: extracted ${servicosFiltros.length} service filters`);
    }

    // Run all retrieval paths in parallel
    // NOTE: searchServicosForContext uses the ORIGINAL query (not rewritten) because SQL ILIKE
    // matching works best with the user's exact terms. The rewrite is only useful for vector search.
    const retrieverIntent =
      intent === 'BUNDLE_SINGLE' || intent === 'BUNDLE_CUMULATIVE' ? 'COMPROVACAO' : intent;

    const [chunks, serviceResults, qtyMatches, obrasResults, comprovacaoMatches] = await Promise.all([
      this.retriever.retrieve(retrievalQuery, dto.filters, retrieverIntent),
      this.extractionApi.searchServicosForContext(dto.query),
      qtyHint
        ? this.extractionApi.findAtestadosComTodosServicos([qtyHint.serviceQuery], qtyHint.minQuantidade)
        : Promise.resolve<{ atestadoId: string; filename: string }[]>([]),
      hasObraFilter
        ? this.extractionApi.findObrasForContext({ localidades, tipo: tipoObra, minValor })
        : Promise.resolve<import('../../../extraction/persistence/repository/obra.repository').ObraContextRow[]>([]),
      servicosFiltros.length > 0
        ? this.resolveComprovacaoWithQualification(servicosFiltros, intent)
        : Promise.resolve<{ atestadoId: string; filename: string }[]>([]),
    ]);

    const maxSimilarity = chunks.length > 0 ? Math.max(...chunks.map((c) => c.similarity)) : 0;
    const hasServiceResults = serviceResults.length > 0;
    const hasQtyResults = qtyMatches.length > 0;
    // When the query names a specific item/service and SQL found exact matches,
    // vector chunk sources are noise — suppress them from both
    // the LLM context and the sources panel so only the precise SQL results are shown.
    // High-confidence triggers: serviço/item/material/insumo/produto
    // Action-word triggers: realizado/executado/instalado/fornecido followed by an
    // uppercase-first item name (guards against "realizado o serviço X" false positives).
    const hasExactItemPhrase =
      /\b(?:item|servi[çc]os?|material|insumo|produto)\s+.{4,}/i.test(dto.query) ||
      /\b(?:realizado|executado|instalado|fornecido)\s+[A-ZÁÉÍÓÚÀÂÊÔÃÕÜÇ][^\n?!]{3,}/i.test(dto.query);
    const exactItemMatch = hasExactItemPhrase && hasServiceResults;
    const hasObrasResults = obrasResults.length > 0;
    const hasComprovacaoResults = comprovacaoMatches.length > 0;

    // Only bail out when ALL retrieval paths yield nothing
    if (maxSimilarity < this.similarityThreshold && !hasServiceResults && !hasQtyResults && !hasObrasResults && !hasComprovacaoResults) {
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

    // COMPROVACAO / BUNDLE_SINGLE / BUNDLE_CUMULATIVE: inject qualifying atestados FIRST so that
    // even if the context is large the definitive SQL result is always visible to the LLM.
    // When results were found, also suppress chunks and the raw service table below — those rows
    // can contradict the pre-computed qualification answer and cause the LLM to return NOT_FOUND.
    if (intent === 'COMPROVACAO' || intent === 'BUNDLE_SINGLE' || intent === 'BUNDLE_CUMULATIVE') {
      const reqList = servicosFiltros
        .map((s) => `• ${s.descricao}${s.minQuantidade !== undefined ? ` — mínimo: ${s.minQuantidade}` : ''}`)
        .join('\n');

      if (hasComprovacaoResults) {
        this.logger.log(`${intent}: ${comprovacaoMatches.length} qualifying atestados found`);

        let headerNote: string;
        if (intent === 'BUNDLE_CUMULATIVE') {
          headerNote = `Conjunto de atestados cujo somatório comprova os requisitos (${comprovacaoMatches.length} atestados no conjunto)`;
        } else if (intent === 'BUNDLE_SINGLE') {
          headerNote = `Conjunto mínimo de atestados cobrindo todos os serviços individualmente (${comprovacaoMatches.length} atestado${comprovacaoMatches.length !== 1 ? 's' : ''})`;
        } else {
          headerNote = `Atestados que comprovam os requisitos solicitados (${comprovacaoMatches.length} encontrados)`;
        }

        const atestadoBlocks = comprovacaoMatches
          .map((r) => `[Fonte: ${r.filename}, p.1]\nEste atestado é parte da comprovação dos seguintes requisitos:\n${reqList}`)
          .join('\n\n---\n\n');
        contextParts.push(`\n\n**${headerNote}:**\n${atestadoBlocks}`);
      } else if (servicosFiltros.length > 0) {
        this.logger.warn(`${intent}: no atestado found satisfying filters`);
        const msg =
          intent === 'BUNDLE_CUMULATIVE'
            ? 'O somatório dos atestados existentes não atinge as quantidades mínimas solicitadas para todos os serviços.'
            : intent === 'BUNDLE_SINGLE'
              ? 'Nenhum conjunto de atestados foi encontrado que cubra todos os serviços exigidos individualmente.'
              : 'Nenhum atestado isolado foi encontrado que satisfaça simultaneamente todos os requisitos solicitados com as quantidades mínimas indicadas.';
        contextParts.push(`\n\n**Comprovação:** ${msg}`);
      }
    }

    // For listing queries, prepend an enumeration of all matching documents as a checklist
    // so the LLM knows about every document before reading the chunks
    if (intent === 'LISTAGEM') {
      const chunkFilenames = (maxSimilarity >= this.similarityThreshold && !exactItemMatch)
        ? chunks.map((c) => `- ${c.originalFilename} (p.${c.pageNumber})`)
        : [];
      const serviceFilenames = serviceResults
        .reduce<string[]>((acc, r) => (acc.includes(r.filename) ? acc : [...acc, r.filename]), [])
        .map((f) => `- ${f} (p.1)`);
      const qtyFilenames = qtyHint && hasQtyResults
        ? qtyMatches.map((r) => `- ${r.filename} (quantidade >= ${qtyHint.minQuantidade})`)
        : [];
      const allEntries = [...new Set([...chunkFilenames, ...serviceFilenames, ...qtyFilenames])];
      if (allEntries.length > 0) {
        contextParts.push(
          `**Documentos encontrados no contexto (${allEntries.length} total — cite TODOS na resposta):**\n${allEntries.join('\n')}`,
        );
      }
      if (qtyHint && hasQtyResults) {
        this.logger.log(`Quantity filter found ${qtyMatches.length} atestados with "${qtyHint.serviceQuery}" >= ${qtyHint.minQuantidade}`);
        contextParts.push(
          qtyMatches
            .map((r) => `[Fonte: ${r.filename}, p.1]\nServiço "${qtyHint.serviceQuery}" executado neste atestado com quantidade >= ${qtyHint.minQuantidade}`)
            .join('\n\n---\n\n'),
        );
      }
    }

    // For non-LISTAGEM intents: if a quantity filter matched, inject those atestados into context
    if (intent !== 'LISTAGEM' && qtyHint && hasQtyResults) {
      this.logger.log(`Quantity filter found ${qtyMatches.length} atestados with "${qtyHint.serviceQuery}" >= ${qtyHint.minQuantidade}`);
      contextParts.push(
        qtyMatches
          .map((r) => `[Fonte: ${r.filename}, p.1]\nServiço "${qtyHint.serviceQuery}" executado neste atestado com quantidade >= ${qtyHint.minQuantidade}`)
          .join('\n\n---\n\n'),
      );
    }

    // Add vector/keyword chunks that pass the threshold.
    // Suppressed when the query names an explicit item and SQL already found exact matches —
    // in that case chunks are unrelated noise that confuses the LLM and pollutes the sources panel.
    // Also suppressed for COMPROVACAO/BUNDLE intents when the qualification SQL already found
    // the answer — raw chunks can mislead the LLM into contradicting the qualification result.
    const isComprovacaoLikeWithResults =
      hasComprovacaoResults &&
      (intent === 'COMPROVACAO' || intent === 'BUNDLE_SINGLE' || intent === 'BUNDLE_CUMULATIVE');
    if (maxSimilarity >= this.similarityThreshold && chunks.length > 0 && !exactItemMatch && !isComprovacaoLikeWithResults) {
      contextParts.push(
        chunks
          .map((c) => `[Fonte: ${c.originalFilename}, p.${c.pageNumber}]\n${c.content}`)
          .join('\n\n---\n\n'),
      );
    }

    // Inject direct SQL service matches as a structured table.
    // Suppressed for COMPROVACAO/BUNDLE when the qualification SQL already determined the result —
    // raw service rows listing individual quantities can confuse the LLM into second-guessing the
    // pre-computed minimum-quantity qualification answer.
    if (hasServiceResults && !isComprovacaoLikeWithResults) {
      this.logger.log(`Direct service search found ${serviceResults.length} rows for query: "${dto.query}"`);
      contextParts.push(`\n\n**Serviços encontrados diretamente no banco de dados:**\n${this.buildServiceContextTable(serviceResults)}`);
    }

    if (intent === 'QUANTITATIVO') {
      const localidade = this.extractLocalidadeHint(dto.query);
      const categoria = this.extractCategoriaHint(dto.query);
      const table = await this.extractionApi.getAnalyticsAsMarkdown({ localidade, categoria });
      if (table) contextParts.push(`\n\n**Dados analíticos (SQL):**\n${table}`);
    }

    // Obras context: inject for QUANTITATIVO and LISTAGEM when localidade/valor/tipo filters are present
    if ((intent === 'QUANTITATIVO' || intent === 'LISTAGEM') && hasObrasResults) {
      this.logger.log(`Obras context: ${obrasResults.length} obras found for localidades=[${localidades.join(', ')}] minValor=${minValor} tipo=${tipoObra}`);
      const obraBlocks = obrasResults.map((o) => {
        const valor = o.valor != null ? ` | Valor: R$ ${o.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '';
        const local = o.local ? ` | Local: ${o.local}` : '';
        const tipo = o.tipo ? ` | Tipo: ${o.tipo}` : '';
        return `[Fonte: ${o.filename}, p.1]\nObra: ${o.nome}${local}${tipo}${valor}`;
      });
      contextParts.push(`\n\n**Obras encontradas no banco de dados:**\n${obraBlocks.join('\n\n---\n\n')}`);
    }

    // COMPROVACAO / BUNDLE context was already injected at the TOP of contextParts above.
    // Nothing to do here — keeping the comment as a landmark for future refactoring.

    if (dto.sessionId) {
      const history = await this.turnRepo.findRecentBySessionId(dto.sessionId, 5);
      if (history.length > 0) {
        const historyText = history.map((t) => `${t.role}: ${t.content}`).join('\n');
        contextParts.push(`\n\n**Histórico recente:**\n${historyText}`);
      }
    }

    // Sources: combine chunk sources + service-result sources + quantity-filter sources.
    // Chunk sources are suppressed when the query names an explicit item and SQL found exact
    // matches — keeps the sources panel clean and prevents unrelated documents from appearing.
    const chunkSources: SourceRef[] = (maxSimilarity >= this.similarityThreshold && !exactItemMatch)
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

    const allSeenAtestados = new Set<string>([...chunkSources, ...serviceSources].map((s) => s.atestadoId));
    const qtySources: SourceRef[] = qtyHint
      ? qtyMatches
          .filter((r) => !allSeenAtestados.has(r.atestadoId))
          .map((r) => ({
            atestadoId: r.atestadoId,
            filename: r.filename,
            pagina: 1,
            trecho: `${qtyHint.serviceQuery} — quantidade >= ${qtyHint.minQuantidade}`,
          }))
      : [];

    // Obras sources (Phase 2)
    const seenForObras = new Set<string>([...chunkSources, ...serviceSources, ...qtySources].map((s) => s.atestadoId));
    const obraSources: SourceRef[] = obrasResults
      .filter((r) => !seenForObras.has(r.atestadoId))
      .reduce<typeof obrasResults>((acc, r) => {
        if (!acc.find((x) => x.atestadoId === r.atestadoId)) acc.push(r);
        return acc;
      }, [])
      .map((r) => ({
        atestadoId: r.atestadoId,
        filename: r.filename,
        pagina: 1,
        trecho: [r.nome, r.local, r.tipo, r.valor != null ? `R$ ${r.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : null]
          .filter(Boolean).join(' | '),
      }));

    // Comprovação sources (Phase 3)
    const seenForComprovacao = new Set<string>([...chunkSources, ...serviceSources, ...qtySources, ...obraSources].map((s) => s.atestadoId));
    const comprovacaoSources: SourceRef[] = comprovacaoMatches
      .filter((r) => !seenForComprovacao.has(r.atestadoId))
      .map((r) => ({
        atestadoId: r.atestadoId,
        filename: r.filename,
        pagina: 1,
        trecho: servicosFiltros.map((s) => s.descricao).join(', '),
      }));

    // For qualification intents, when the SQL path found results, expose ONLY those atestados
    // in the sources panel. The other arrays (chunks, service, qty, obras) were used for LLM
    // context but are noise in the sources panel for these intents.
    // Fall back to the full combined array when qualification found nothing (RAG fallback path).
    const isComprovacaoIntent =
      intent === 'COMPROVACAO' || intent === 'BUNDLE_SINGLE' || intent === 'BUNDLE_CUMULATIVE';
    const qualSources: SourceRef[] = comprovacaoMatches.map((r) => ({
      atestadoId: r.atestadoId,
      filename: r.filename,
      pagina: 1,
      trecho: servicosFiltros.map((s) => s.descricao).join(', '),
    }));
    const sources: SourceRef[] =
      isComprovacaoIntent && qualSources.length > 0
        ? qualSources
        : [...chunkSources, ...serviceSources, ...qtySources, ...obraSources, ...comprovacaoSources];
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

  /**
   * Parses a minimum-quantity constraint from a query, e.g.:
   *   "maior que 1000 de Aperto em alvenaria"  → { minQuantidade: 1000, serviceQuery: "Aperto em alvenaria" }
   *   "mínimo de 200.292,09 de AAUQ"           → { minQuantidade: 200292.09, serviceQuery: "AAUQ" }
   * Returns undefined when no quantity constraint is found.
   */
  private extractQuantidadeMinima(query: string): { minQuantidade: number; serviceQuery: string } | undefined {
    const match = query.match(
      /(?:quantidade\s+)?(?:maior(?:\s+que)?|m[ií]nima?\s*(?:de)?|acima\s+de|no\s+m[ií]nimo|superior\s+a)\s+([\d.,]+)\s+(?:de\s+)?(.+)/i,
    );
    if (!match) return undefined;
    // Parse BR-formatted numbers: "1.000" → 1000; "200.292,09" → 200292.09
    const raw = match[1].replace(/\.(?=\d{3})/g, '').replace(',', '.');
    const minQuantidade = parseFloat(raw);
    if (isNaN(minQuantidade) || minQuantidade <= 0) return undefined;
    return { minQuantidade, serviceQuery: match[2].trim() };
  }

  /** Returns all state names/abbreviations mentioned in the query (used for multi-state obra search). */
  private extractLocalidades(query: string): string[] {
    const matches = query.match(
      /\b(piau[íi]|maranha[oõ]|bahia|cear[aá]|par[aá]|amazonas|tocantins|goi[aá]s|minas\s+gerais|s[aã]o\s+paulo|rio\s+de\s+janeiro|paran[aá]|santa\s+catarina|rio\s+grande\s+do\s+sul|mato\s+grosso(?:\s+do\s+sul)?|esp[íi]rito\s+santo|alagoas|sergipe|pernambuco|para[íi]ba|rio\s+grande\s+do\s+norte|rond[oô]nia|acre|roraima|amap[aá]|df|pi|ma|ba|ce|sp|rj|mg|pr|sc|rs|mt|go|pa|am|to|es|al|se|pe|pb|rn|ro|ac|rr|ap|ms)\b/gi,
    );
    return matches ? [...new Set(matches.map((m) => m.trim()))] : [];
  }

  /** Parses "valores superiores a R$ 50.000.000,00" → 50000000. */
  private extractMinValor(query: string): number | undefined {
    const match = query.match(
      /(?:valores?\s+(?:superiores?|acima|maior(?:es)?)\s+a\s+)?R\$\s*([\d.,]+(?:\s+milh[oõ]es?)?)/i,
    );
    if (!match) return undefined;
    let raw = match[1].trim();
    const milhoes = /milh[oõ]es?/i.test(raw);
    raw = raw.replace(/milh[oõ]es?/i, '').trim();
    raw = raw.replace(/\.(?=\d{3})/g, '').replace(',', '.');
    const val = parseFloat(raw);
    if (isNaN(val) || val <= 0) return undefined;
    return milhoes ? val * 1_000_000 : val;
  }

  /** Parses tipo de obra from the query (e.g. "infraestrutura", "implantação"). */
  private extractTipoObra(query: string): string | undefined {
    const m = query.match(
      /\b(infraestrutura|implanta[çc][aã]o|restaura[çc][aã]o|duplica[çc][aã]o|conserva[çc][aã]o|manuten[çc][aã]o|recupera[çc][aã]o|pavimenta[çc][aã]o|drenagem|saneamento|edifica[çc][aã]o|condom[íi]nio|residencial|rodoviária|rodoviario|ferrovi[áa]ria|ferrovi[áa]rio|hidroviária|hidroviario|portu[áa]ria|portu[áa]rio)\b/i,
    );
    return m?.[0];
  }

  /**
   * Uses GPT-4o-mini to extract a list of { descricao, minQuantidade, unidade } from a
   * comprovação query. Returns [] on failure so normal retrieval acts as fallback.
   */
  private async extractServicosComQuantidades(query: string): Promise<ServicoFilter[]> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        stream: false,
        temperature: 0,
        max_tokens: 400,
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente que extrai informações estruturadas de requisitos de habilitação de obras públicas. ' +
              'Dado o texto do usuário, retorne um array JSON com os serviços/materiais mencionados e suas quantidades mínimas. ' +
              'Formato: [{"descricao":"<nome do serviço>","minQuantidade":<número ou null>,"unidade":"<unidade ou null>"}]. ' +
              'Use null quando a quantidade não for especificada. Responda SOMENTE com o JSON array, sem markdown.',
          },
          { role: 'user', content: query },
        ],
      });
      const raw = completion.choices[0]?.message?.content?.trim() ?? '';
      const parsed = JSON.parse(raw) as { descricao: string; minQuantidade: number | null; unidade?: string | null }[];
      return parsed
        .filter((r) => r.descricao && r.descricao.trim().length > 0)
        .map((r) => ({
          descricao: r.descricao.trim(),
          minQuantidade: r.minQuantidade != null && r.minQuantidade > 0 ? r.minQuantidade : undefined,
        }));
    } catch (err) {
      this.logger.warn(`extractServicosComQuantidades failed, skipping: ${err}`);
      return [];
    }
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
    // No parseable citations — return all sources
    if (cited.size === 0) return sources;

    // Pre-compute lowercase response for literal filename scanning
    const responseTextLower = response.toLowerCase();

    // Match sources against cited filenames using substring matching:
    // the LLM may write a shortened or slightly different version of the filename.
    // Also match filenames that appear literally in the response text — the LLM sometimes
    // lists document names in a numbered list without [Fonte:] format, e.g.:
    //   "1. Atestado CIV Bom Preço São Luis Shopping.pdf"
    // Guard with length >= 15 to avoid false positives from very short filenames.
    const matched = sources.filter((s) => {
      const fn = s.filename.toLowerCase();
      for (const c of cited) {
        if (fn === c || fn.includes(c) || c.includes(fn)) return true;
      }
      if (fn.length >= 15 && responseTextLower.includes(fn)) return true;
      return false;
    });
    // If citations were parsed but none matched, fall back to all sources.
    return matched.length > 0 ? matched : sources;
  }

  private detectIntent(query: string): QueryIntent {
    if (BUNDLE_CUMULATIVE_KEYWORDS.test(query)) return 'BUNDLE_CUMULATIVE';
    if (BUNDLE_SINGLE_KEYWORDS.test(query)) return 'BUNDLE_SINGLE';
    if (COMPROVACAO_KEYWORDS.test(query)) return 'COMPROVACAO';
    if (QUANTITATIVO_KEYWORDS.test(query)) return 'QUANTITATIVO';
    if (LISTAGEM_KEYWORDS.test(query)) return 'LISTAGEM';
    return 'NARRATIVO';
  }

  /**
   * Attempts qualification service for COMPROVACAO/BUNDLE_SINGLE/BUNDLE_CUMULATIVE intents.
   * Falls back to extractionApi.findAtestadosComServicosFilter on error or empty results.
   */
  private async resolveComprovacaoWithQualification(
    servicosFiltros: ServicoFilter[],
    intent: QueryIntent,
  ): Promise<{ atestadoId: string; filename: string }[]> {
    const serviceReqs = servicosFiltros.map((sf) => ({
      query: sf.descricao,
      minQuantidade: sf.minQuantidade,
    }));

    try {
      if (intent === 'BUNDLE_CUMULATIVE') {
        const cumulativoResults = await this.qualificationService.findBundleCumulativeCoverage(serviceReqs);
        const seen = new Set<string>();
        const result: { atestadoId: string; filename: string }[] = [];
        for (const svc of cumulativoResults) {
          for (const a of svc.qualifyingAtestados) {
            if (!seen.has(a.atestadoId)) {
              seen.add(a.atestadoId);
              result.push({ atestadoId: a.atestadoId, filename: a.filename });
            }
          }
        }
        if (result.length > 0) return result;
      } else {
        // COMPROVACAO or BUNDLE_SINGLE: greedy set cover
        const bundleResult = await this.qualificationService.findBundleSingleCoverage(serviceReqs);
        if (bundleResult.minimumSet.length > 0) {
          return bundleResult.minimumSet.map((s) => ({ atestadoId: s.atestadoId, filename: s.filename }));
        }
      }
    } catch (err) {
      this.logger.error('Qualification service error, falling back to extractionApi:', err);
    }

    this.logger.warn(`${intent}: qualification returned no results, falling back to extractionApi`);
    return this.extractionApi.findAtestadosComServicosFilter(servicosFiltros);
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
