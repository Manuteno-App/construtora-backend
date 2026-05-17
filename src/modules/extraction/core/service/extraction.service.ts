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

    const fullText = chunks.map((c) => c.content).join('\n\n---\n\n');
    const contextText = fullText.slice(0, 6000);

    this.logger.log(
      `Extraction context: ${fullText.length} chars total, ${chunks.length} chunks. ` +
        `keyValuePairs keys: [${Object.keys(params.keyValuePairs ?? {}).join(', ')}]. ` +
        `Preview: ${fullText.slice(0, 300).replace(/\n/g, ' ')}`,
    );

    const entities = await this.extractEntitiesFromText(
      contextText,
      params.keyValuePairs ?? {},
    );

    // Apply Vision header hints as fallbacks when LLM extraction returned null
    const kv = params.keyValuePairs ?? {};
    if (!entities.obra && kv['obra']) {
      entities.obra = { nome: kv['obra'] };
    }
    if (entities.obra) {
      (entities.obra as Record<string, unknown>)['nome'] ??= kv['obra'];
      (entities.obra as Record<string, unknown>)['cliente'] ??= kv['contratante'];
      (entities.obra as Record<string, unknown>)['cidade'] ??= kv['cidade'];
      (entities.obra as Record<string, unknown>)['estado'] ??= kv['estado'];
      (entities.obra as Record<string, unknown>)['engenheiro'] ??= kv['engenheiro'];
    }

    let tabelaServicos = params.tabelaServicos;
    if (tabelaServicos.length === 0) {
      if (fullText.length < 500) {
        this.logger.warn(
          `Skipping services extraction — text too short (${fullText.length} chars), likely OCR refusal or empty document`,
        );
      } else {
        this.logger.log('No services from ingestion — running GPT services extraction');
        tabelaServicos = await this.extractServicosFromText(fullText);
        this.logger.log(`GPT services extraction found ${tabelaServicos.length} items`);
      }
    }

    await this.orchestration.persistExtractedEntities(
      entities,
      params.atestadoId,
      tabelaServicos,
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
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    try {
      return JSON.parse(this.stripJsonFences(content)) as ExtractedEntities;
    } catch {
      this.logger.warn('Failed to parse GPT-4 JSON response', content);
      return {};
    }
  }

  private async extractServicosFromText(text: string): Promise<ServicoItem[]> {
    const prompt = `Você é um extrator especialista em Atestados de Capacidade Técnica (CAT) de obras de construção civil brasileiras.

Analise o texto abaixo e extraia TODOS os itens da tabela de serviços executados.
Retorne um objeto JSON com a chave "servicos" contendo um array de itens.

INSTRUÇÕES:
- "categoria": nome da categoria/seção à qual o item pertence (ex: "TERRAPLENAGEM", "PAVIMENTAÇÃO", "DRENAGEM")
- "codigo": código do item (ex: "01.01", "E-01") — null se não houver
- "descricao": descrição completa do serviço
- "unidade": unidade de medida (ex: "m²", "m³", "km", "un", "m") — null se não houver
- "quantidade": valor numérico da quantidade — null se não houver
- Inclua TODOS os serviços com quantidade; ignore linhas de cabeçalho sem quantidade
- Preserve a hierarquia de categorias: cada item herda a categoria da seção acima

TEXTO:
${text}

Formato esperado:
{ "servicos": [ { "categoria": "string", "codigo": "string ou null", "descricao": "string", "unidade": "string ou null", "quantidade": number ou null } ] }`;

    const response = await this.openai.chat.completions.create({
      model: this.extractionModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 16000,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{"servicos":[]}';
    const finishReason = response.choices[0]?.finish_reason;
    if (finishReason === 'length') {
      this.logger.warn('GPT services extraction was truncated (finish_reason=length) — partial results may be returned');
    }

    try {
      const parsed = JSON.parse(this.stripJsonFences(content)) as { servicos?: ServicoItem[] };
      const items = Array.isArray(parsed.servicos) ? parsed.servicos : [];
      return items.filter((s) => s && typeof s.descricao === 'string' && s.descricao.trim());
    } catch {
      this.logger.warn('Failed to parse GPT-4 services JSON response', content);
      return [];
    }
  }

  /** Strip ```json ... ``` or ``` ... ``` fences that LLMs sometimes add. */
  private stripJsonFences(raw: string): string {
    return raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  }
}
