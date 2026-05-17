import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ServicoItem } from '../../../ingestion/core/service/table-extractor.service';
import { IIngestionApi, INGESTION_API } from '../../../ingestion/public-api/interface/ingestion-api.interface';
import { EntityOrchestrationService, ExtractedEntities } from './entity-orchestration.service';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly openai: OpenAI;
  private readonly extractionModel: string;

  constructor(
    private readonly config: ConfigService,
    private readonly orchestration: EntityOrchestrationService,
    @Inject(INGESTION_API) private readonly ingestionApi: IIngestionApi,
  ) {
    this.openai = new OpenAI({ apiKey: config.get<string>('openaiApiKey') });
    this.extractionModel = config.get<string>('extractionModel') ?? 'gpt-4o-mini';
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
      .slice(0, 6000);

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

    const prompt = `Você é um extrator especialista em Atestados de Capacidade Técnica (CAT) de obras de construção civil brasileiras.
Analise o texto abaixo e extraia as informações no formato JSON especificado.
Retorne SOMENTE o JSON, sem explicações adicionais.${hintsSection}

INSTRUÇÕES:
- "obra.nome": nome ou descrição da obra/serviço executado
- "obra.cidade": cidade onde a OBRA foi executada (não a sede da empresa)
- "obra.estado": UF de 2 letras onde a OBRA foi executada
- "obra.local": cidade e estado combinados (ex: "Santana do Ipanema/AL"), use se cidade/estado não forem separáveis
- "obra.tipo": tipo de obra (ex: pavimentação, esgotamento sanitário, edificação)
- "obra.dataAtestado": data de emissão do atestado/certidão (campo "data" ou "emitido em")
- "obra.dataInicio": data de início dos serviços
- "obra.dataFim": data de conclusão dos serviços
- "obra.valor": valor total da obra/contrato em reais (número sem R$)
- "obra.valorAtestado": valor declarado no atestado/certidão em reais (pode diferir do valor da obra)
- "obra.cliente": nome da empresa/órgão CONTRATANTE (quem emitiu o atestado)
- "obra.engenheiro": nome do engenheiro responsável técnico mencionado no documento
- "obra.art": número da ART/RRT
- "empresas": lista de empresas mencionadas com tipo CONTRATANTE ou CONTRATADA
- "contrato.numero": número do contrato (ex: "0.00.08.0053-00")

TEXTO:
${text}

JSON esperado:
{
  "obra": {
    "nome": "string ou null",
    "cidade": "string ou null",
    "estado": "UF 2 letras ou null",
    "local": "string ou null",
    "tipo": "string ou null",
    "dataAtestado": "YYYY-MM-DD ou null",
    "dataInicio": "YYYY-MM-DD ou null",
    "dataFim": "YYYY-MM-DD ou null",
    "valor": number ou null,
    "valorAtestado": number ou null,
    "cliente": "nome do contratante ou null",
    "engenheiro": "nome do engenheiro ou null",
    "art": "string ou null"
  },
  "empresas": [
    { "nome": "string", "cnpj": "string ou null", "tipo": "CONTRATANTE ou CONTRATADA" }
  ],
  "contrato": {
    "numero": "string ou null",
    "data": "YYYY-MM-DD ou null",
    "valor": number ou null
  }
}`;

    const response = await this.openai.chat.completions.create({
      model: this.extractionModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 2000,
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
