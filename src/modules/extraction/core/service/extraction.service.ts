import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { EntityOrchestrationService, ExtractedEntities } from './entity-orchestration.service';
import { IIngestionApi, INGESTION_API } from '../../../ingestion/public-api/interface/ingestion-api.interface';
import type { ServicoItem } from '../../../ingestion/core/service/table-extractor.service';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly orchestration: EntityOrchestrationService,
    @Inject(INGESTION_API) private readonly ingestionApi: IIngestionApi,
  ) {
    this.openai = new OpenAI({ apiKey: config.get<string>('openaiApiKey') });
  }

  async extractAndPersist(params: {
    atestadoId: string;
    chunkIds: string[];
    tabelaServicos: ServicoItem[];
    keyValuePairs?: Record<string, string>;
  }): Promise<void> {
    const chunks = await this.ingestionApi.getChunksByIds(params.chunkIds);

    const contextText = chunks
      .map((c) => c.content)
      .join('\n\n---\n\n')
      .slice(0, 12000);

    const entities = await this.extractEntitiesFromText(
      contextText,
      params.keyValuePairs ?? {},
    );

    await this.orchestration.persistExtractedEntities(
      entities,
      params.atestadoId,
      params.tabelaServicos,
    );
  }

  private async extractEntitiesFromText(
    text: string,
    hints: Record<string, string>,
  ): Promise<ExtractedEntities> {
    const hintLines = Object.entries(hints)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join('\n');
    const hintsSection = hintLines
      ? `\nCAMPOS JÁ DETECTADOS AUTOMATICAMENTE (use como referência):\n${hintLines}\n`
      : '';

    const prompt = `Você é um extrator de entidades de atestados de execução de obras.
Analise o texto abaixo e extraia as informações no formato JSON especificado.
Retorne SOMENTE o JSON, sem explicações adicionais.${hintsSection}

TEXTO:
${text}

JSON esperado:
{
  "obra": {
    "nome": "string",
    "local": "string (cidade/estado)",
    "tipo": "string (ex: pavimentação, drenagem, edificação)",
    "dataInicio": "YYYY-MM-DD ou null",
    "dataFim": "YYYY-MM-DD ou null",
    "valor": number ou null,
    "art": "número da ART ou null"
  },
  "empresas": [
    { "nome": "string", "cnpj": "string", "tipo": "CONTRATANTE ou CONTRATADA" }
  ],
  "contrato": {
    "numero": "string ou null",
    "data": "YYYY-MM-DD ou null",
    "valor": number ou null
  }
}`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 1000,
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    try {
      return JSON.parse(content) as ExtractedEntities;
    } catch {
      this.logger.warn('Failed to parse GPT-4 JSON response', content);
      return {};
    }
  }
}
