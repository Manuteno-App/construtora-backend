import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Atestado, AtestadoStatus } from '../../database/entities/atestado.entity';
import { Obra } from '../../database/entities/obra.entity';
import { Empresa, EmpresaTipo } from '../../database/entities/empresa.entity';
import { Contrato } from '../../database/entities/contrato.entity';
import { ServicoExecutado } from '../../database/entities/servico-executado.entity';
import { Chunk } from '../../database/entities/chunk.entity';
import { EXTRACTION_QUEUE, INDEXING_QUEUE } from '../../queue/queue.module';
import type { ServicoItem } from '../../ingestion/services/table-extractor.service';

export interface ExtractionJobPayload {
  atestadoId: string;
  chunkIds: string[];
  tabelaServicos: ServicoItem[];
  /** Key-value pairs extracted by Textract FORMS — used to pre-populate entities without LLM */
  keyValuePairs?: Record<string, string>;
}

interface ExtractedEntities {
  obra?: {
    nome: string;
    local?: string;
    tipo?: string;
    dataInicio?: string;
    dataFim?: string;
    valor?: number;
    art?: string;
  };
  empresas?: Array<{
    nome: string;
    cnpj?: string;
    tipo?: string;
  }>;
  contrato?: {
    numero?: string;
    data?: string;
    valor?: number;
  };
}

@Processor(EXTRACTION_QUEUE)
export class ExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExtractionProcessor.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Atestado)
    private readonly atestadoRepo: Repository<Atestado>,
    @InjectRepository(Obra)
    private readonly obraRepo: Repository<Obra>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    @InjectRepository(Contrato)
    private readonly contratoRepo: Repository<Contrato>,
    @InjectRepository(ServicoExecutado)
    private readonly servicoRepo: Repository<ServicoExecutado>,
    @InjectRepository(Chunk)
    private readonly chunkRepo: Repository<Chunk>,
    @InjectQueue(INDEXING_QUEUE)
    private readonly indexingQueue: Queue,
  ) {
    super();
    this.openai = new OpenAI({ apiKey: config.get<string>('openaiApiKey') });
  }

  async process(job: Job<ExtractionJobPayload>): Promise<void> {
    const { atestadoId, chunkIds, tabelaServicos, keyValuePairs = {} } = job.data;
    this.logger.log(`Processing extraction for atestado ${atestadoId}`);

    try {
      // Get all chunks (not just first 5) for better entity coverage
      const chunks = await this.chunkRepo.findBy(chunkIds.map((id) => ({ id })));
      // Cap context at ~12000 chars to stay within model limits
      const contextText = chunks
        .map((c) => c.content)
        .join('\n\n---\n\n')
        .slice(0, 12000);

      const entities = await this.extractEntities(contextText, keyValuePairs);

      let savedObraId: string | undefined;

      if (entities.obra) {
        const obra = this.obraRepo.create({
          atestadoId,
          nome: entities.obra.nome,
          local: entities.obra.local,
          tipo: entities.obra.tipo,
          dataInicio: entities.obra.dataInicio ? new Date(entities.obra.dataInicio) : undefined,
          dataFim: entities.obra.dataFim ? new Date(entities.obra.dataFim) : undefined,
          valor: entities.obra.valor,
          art: entities.obra.art,
        });
        const savedObra = await this.obraRepo.save(obra);
        savedObraId = savedObra.id;

        // Persist empresas and contratos
        if (entities.empresas?.length) {
          for (const emp of entities.empresas) {
            let empresa = emp.cnpj
              ? await this.empresaRepo.findOne({ where: { cnpj: emp.cnpj } })
              : null;

            if (!empresa) {
              empresa = this.empresaRepo.create({
                nome: emp.nome,
                cnpj: emp.cnpj,
                tipo: (emp.tipo as EmpresaTipo) ?? undefined,
              });
              empresa = await this.empresaRepo.save(empresa);
            }

            if (entities.contrato) {
              const contrato = this.contratoRepo.create({
                obraId: savedObra.id,
                empresaId: empresa.id,
                numero: entities.contrato.numero,
                data: entities.contrato.data ? new Date(entities.contrato.data) : undefined,
                valor: entities.contrato.valor,
              });
              await this.contratoRepo.save(contrato);
            }
          }
        }
      }

      // Persist servicos executados with idempotency
      if (tabelaServicos.length > 0) {
        const servicoValues = tabelaServicos.map((s) => ({
          atestadoId,
          obraId: savedObraId,
          trecho: s.trecho,
          categoria: s.categoria,
          codigo: s.codigo,
          descricao: s.descricao,
          unidade: s.unidade,
          quantidade: s.quantidade,
        }));

        // Upsert: skip on conflict by unique key (atestadoId, codigo, trecho)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.servicoRepo
          .createQueryBuilder()
          .insert()
          .into(ServicoExecutado)
          .values(servicoValues as any[])
          .orIgnore()
          .execute();
      }

      // Enqueue indexing job
      await this.indexingQueue.add('index-embeddings', { atestadoId, chunkIds });

      this.logger.log(`Extraction complete for ${atestadoId}`);
    } catch (err) {
      this.logger.error(`Extraction failed for ${atestadoId}`, err);
      await this.atestadoRepo.update(atestadoId, {
        status: AtestadoStatus.ERROR,
        errorMessage: String(err),
      });
      throw err;
    }
  }

  private async extractEntities(
    text: string,
    hints: Record<string, string>,
  ): Promise<ExtractedEntities> {
    // Format Textract FORMS key-value pairs as hints for the prompt
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
