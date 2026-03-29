import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import OpenAI from 'openai';
import { EXTRACTION_API, IExtractionApi } from '../../../extraction/public-api/interface/extraction-api.interface';
import { ConversationRole } from '../../persistence/entity/conversation-turn.entity';
import { ConversationTurnRepository } from '../../persistence/repository/conversation-turn.repository';
import { HybridRetrieverService, RetrievalFilters, RetrievedChunk } from './hybrid-retriever.service';

const NOT_FOUND_MESSAGE = 'Não encontrei informações sobre isso nos documentos indexados.';

// gpt-4o-mini has a 128k-token context window.
// Portuguese text tokenizes at ~3 chars/token.
// Budget: 120000 usable tokens * 3 chars/token = 360000 chars — using 80000 to leave ample room for system prompt, query and response.
const MAX_CONTEXT_CHARS = 80000;

const SYSTEM_PROMPT = `Você é um assistente especializado em atestados de execução de obras.
Responda SOMENTE com base nos trechos de documentos fornecidos abaixo.
Se a informação solicitada não estiver presente nos trechos, responda exatamente: "${NOT_FOUND_MESSAGE}"
Não invente dados, valores, datas, nomes ou quantidades.
Ao citar um dado, sempre indique o documento de origem no formato [Fonte: <filename>, p.<pagina>].`;

type QueryIntent = 'QUANTITATIVO' | 'LISTAGEM' | 'NARRATIVO';

const QUANTITATIVO_KEYWORDS = /total|volume|quantidade|soma|quanto|somar|somatório|medição/i;
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
      const { notFound, sources, context } = await this.buildContext(dto);

      if (notFound) {
        emit({ type: 'text', content: NOT_FOUND_MESSAGE });
        emit({ type: 'done' });
        await this.persistTurns(dto.query, NOT_FOUND_MESSAGE, dto.sessionId, []);
        res.end();
        return;
      }

      const stream = await this.openai.chat.completions.create({
        model: this.chatModel,
        stream: true,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `CONTEXTO:\n${context}\n\nPERGUNTA: ${dto.query}` },
        ],
      });

      let fullResponse = '';
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          fullResponse += delta;
          emit({ type: 'text', content: delta });
        }
      }

      emit({ type: 'sources', sources });
      emit({ type: 'done' });

      await this.persistTurns(dto.query, fullResponse, dto.sessionId, sources);
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
    const { notFound, sources, context } = await this.buildContext(dto);

    if (notFound) {
      await this.persistTurns(dto.query, NOT_FOUND_MESSAGE, dto.sessionId, []);
      return { answer: NOT_FOUND_MESSAGE, sources: [], notFound: true };
    }

    const completion = await this.openai.chat.completions.create({
      model: this.chatModel,
      stream: false,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `CONTEXTO:\n${context}\n\nPERGUNTA: ${dto.query}` },
      ],
    });

    const text = completion.choices[0]?.message?.content ?? NOT_FOUND_MESSAGE;
    await this.persistTurns(dto.query, text, dto.sessionId, sources);

    return { answer: text, sources, notFound: false };
  }

  private async buildContext(dto: QueryDto): Promise<{
    notFound: boolean;
    chunks: RetrievedChunk[];
    sources: SourceRef[];
    context: string;
  }> {
    const intent = this.detectIntent(dto.query);
    const chunks = await this.retriever.retrieve(dto.query, dto.filters);

    const maxSimilarity = chunks.length > 0 ? Math.max(...chunks.map((c) => c.similarity)) : 0;
    if (maxSimilarity < this.similarityThreshold) {
      if (chunks.length === 0) {
        this.logger.warn(`NotFound: retriever returned 0 chunks for query: "${dto.query}"`);
      } else {
        this.logger.warn(
          `NotFound: ${chunks.length} chunks found but maxSimilarity=${maxSimilarity.toFixed(3)} < threshold=${this.similarityThreshold}. ` +
          `Top chunks: ${chunks.slice(0, 3).map((c) => `"${c.originalFilename}" p.${c.pageNumber} sim=${Number(c.similarity).toFixed(3)}`).join(' | ')}`,
        );
      }
      return { notFound: true, chunks: [], sources: [], context: '' };
    }

    const contextParts: string[] = [];

    contextParts.push(
      chunks
        .map((c) => `[Fonte: ${c.originalFilename}, p.${c.pageNumber}]\n${c.content}`)
        .join('\n\n---\n\n'),
    );

    if (intent === 'QUANTITATIVO') {
      const table = await this.extractionApi.getQuantitativosAsMarkdown({});
      if (table) contextParts.push(`\n\n**Dados quantitativos (SQL):**\n${table}`);
    }

    if (dto.sessionId) {
      const history = await this.turnRepo.findRecentBySessionId(dto.sessionId, 5);
      if (history.length > 0) {
        const historyText = history.map((t) => `${t.role}: ${t.content}`).join('\n');
        contextParts.push(`\n\n**Histórico recente:**\n${historyText}`);
      }
    }

    const sources: SourceRef[] = chunks.map((c) => ({
      atestadoId: c.atestadoId,
      filename: c.originalFilename,
      pagina: c.pageNumber,
      trecho: c.content.slice(0, 200),
    }));

    const context = this.truncateContext(contextParts.join('\n\n'));

    return { notFound: false, chunks, sources, context };
  }

  private truncateContext(text: string): string {
    if (text.length <= MAX_CONTEXT_CHARS) return text;
    this.logger.warn(
      `Context truncated from ${text.length} to ${MAX_CONTEXT_CHARS} chars to stay within model token limit`,
    );
    return text.slice(0, MAX_CONTEXT_CHARS) + '\n\n[... conteúdo truncado por limite de contexto ...]';
  }

  private detectIntent(query: string): QueryIntent {
    if (QUANTITATIVO_KEYWORDS.test(query)) return 'QUANTITATIVO';
    if (LISTAGEM_KEYWORDS.test(query)) return 'LISTAGEM';
    return 'NARRATIVO';
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
