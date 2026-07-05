import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { QualificationService } from '../qualification/core/service/qualification.service';
import { QualificationFilters, ServiceRequirement } from '../qualification/public-api/interface/qualification-api.interface';

const MCP_PROTOCOL_VERSION = '2024-11-05';

const TOOL_DEFINITIONS = [
  {
    name: 'resolve_service_descriptions',
    description:
      'Encontra descrições de serviços similares no banco de dados de atestados. ' +
      'Use antes de buscar atestados para resolver termos parciais ou sinônimos.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto do serviço a buscar (ex: "pavimentação asfáltica")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_attestations_with_service',
    description:
      'F1 — Retorna atestados que possuem o serviço descrito. ' +
      'Inclui fonte completa: obra, local, datas, valor, número do contrato.',
    inputSchema: {
      type: 'object',
      properties: {
        descricoes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de descrições de serviços (usar saída de resolve_service_descriptions)',
        },
        filters: {
          type: 'object',
          description: 'Filtros opcionais',
          properties: {
            dataInicio: { type: 'string', description: 'Data início mínima (YYYY-MM-DD)' },
            dataFim: { type: 'string', description: 'Data fim máxima (YYYY-MM-DD)' },
            localidade: { type: 'string', description: 'Estado ou cidade (ILIKE)' },
            minValor: { type: 'number', description: 'Valor mínimo da obra (R$)' },
          },
        },
      },
      required: ['descricoes'],
    },
  },
  {
    name: 'find_attestations_with_min_quantity',
    description: 'F2 — Retorna atestados onde SUM(quantidade) do serviço >= minQuantidade em um único atestado.',
    inputSchema: {
      type: 'object',
      properties: {
        descricoes: { type: 'array', items: { type: 'string' }, description: 'Lista de descrições' },
        minQuantidade: { type: 'number', description: 'Quantidade mínima exigida em um único atestado' },
        filters: { type: 'object', description: 'Filtros opcionais (dataInicio, dataFim, localidade, minValor)' },
      },
      required: ['descricoes', 'minQuantidade'],
    },
  },
  {
    name: 'find_cumulative_attestations',
    description:
      'F3 — Retorna o conjunto de atestados cujo somatório de quantidade atinge o mínimo exigido (acervo cumulativo).',
    inputSchema: {
      type: 'object',
      properties: {
        descricoes: { type: 'array', items: { type: 'string' }, description: 'Lista de descrições' },
        minQuantidade: { type: 'number', description: 'Quantidade total mínima exigida' },
        filters: { type: 'object', description: 'Filtros opcionais' },
      },
      required: ['descricoes', 'minQuantidade'],
    },
  },
  {
    name: 'find_bundle_single_coverage',
    description:
      'F4 — Retorna o conjunto MÍNIMO de atestados que cobre todos os serviços exigidos individualmente ' +
      '(algoritmo greedy set cover). Ideal para "um único atestado por serviço".',
    inputSchema: {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Descrição do serviço' },
              minQuantidade: { type: 'number', description: 'Quantidade mínima exigida (opcional)' },
            },
            required: ['query'],
          },
          description: 'Lista de serviços com suas quantidades mínimas',
        },
        filters: { type: 'object', description: 'Filtros opcionais' },
      },
      required: ['services'],
    },
  },
  {
    name: 'find_bundle_cumulative_coverage',
    description:
      'F5 — Para cada serviço do bundle, retorna o conjunto de atestados cujo somatório atinge o mínimo exigido.',
    inputSchema: {
      type: 'object',
      properties: {
        services: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              minQuantidade: { type: 'number' },
            },
            required: ['query'],
          },
        },
        filters: { type: 'object' },
      },
      required: ['services'],
    },
  },
  {
    name: 'get_attestation_details',
    description: 'Retorna detalhes completos de um atestado específico por ID.',
    inputSchema: {
      type: 'object',
      properties: {
        atestadoId: { type: 'string', description: 'UUID do atestado' },
      },
      required: ['atestadoId'],
    },
  },
];

interface McpMessage {
  jsonrpc: '2.0';
  method?: string;
  params?: unknown;
  id?: string | number | null;
}

interface McpError extends Error {
  code?: number;
}

@ApiTags('mcp')
@Controller('mcp')
export class McpController {
  constructor(private readonly qualificationService: QualificationService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'MCP StreamableHTTP endpoint — JSON-RPC 2.0 tool server' })
  async handleMcp(@Body() body: unknown, @Res() res: Response): Promise<void> {
    if (Array.isArray(body)) {
      const responses = await Promise.all(body.map((msg) => this.processMessage(msg as McpMessage)));
      const filtered = responses.filter((r): r is Record<string, unknown> => r !== null);
      if (filtered.length === 0) {
        res.status(202).send();
        return;
      }
      res.json(filtered);
      return;
    }

    const response = await this.processMessage(body as McpMessage);
    if (response === null) {
      res.status(202).send();
      return;
    }
    res.json(response);
  }

  private async processMessage(msg: McpMessage): Promise<Record<string, unknown> | null> {
    // Notification (no id) → no response
    if (msg.id === undefined || msg.id === null) return null;

    const { id, method, params } = msg;
    if (!method) return this.errorResponse(id, -32600, 'Invalid Request: missing method');

    try {
      const result = await this.dispatch(method, params);
      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      const e = err as McpError;
      return this.errorResponse(id, typeof e.code === 'number' ? e.code : -32603, e.message ?? 'Internal error');
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'construtora-qualification', version: '1.0.0' },
        };
      case 'initialized':
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOL_DEFINITIONS };
      case 'tools/call':
        return this.handleToolCall(params as { name: string; arguments: Record<string, unknown> });
      default: {
        const err: McpError = Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
        throw err;
      }
    }
  }

  private async handleToolCall(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ content: { type: string; text: string }[] }> {
    const { name, arguments: args } = params;

    const toText = (data: unknown) => JSON.stringify(data, null, 2);

    switch (name) {
      case 'resolve_service_descriptions': {
        const result = await this.qualificationService.resolveDescricoes(args.query as string);
        return { content: [{ type: 'text', text: toText(result) }] };
      }
      case 'find_attestations_with_service': {
        const result = await this.qualificationService.findAtestadosComServico(
          args.descricoes as string[],
          args.filters as QualificationFilters | undefined,
        );
        return { content: [{ type: 'text', text: toText(result) }] };
      }
      case 'find_attestations_with_min_quantity': {
        const result = await this.qualificationService.findAtestadosComQuantidadeMinima(
          args.descricoes as string[],
          args.minQuantidade as number,
          args.unidade as string | undefined,
          args.filters as QualificationFilters | undefined,
        );
        return { content: [{ type: 'text', text: toText(result) }] };
      }
      case 'find_cumulative_attestations': {
        const result = await this.qualificationService.findCumulativoAtestados(
          args.descricoes as string[],
          args.minQuantidade as number,
          args.unidade as string | undefined,
          args.filters as QualificationFilters | undefined,
        );
        return { content: [{ type: 'text', text: toText(result) }] };
      }
      case 'find_bundle_single_coverage': {
        const result = await this.qualificationService.findBundleSingleCoverage(
          args.services as ServiceRequirement[],
          args.filters as QualificationFilters | undefined,
        );
        return { content: [{ type: 'text', text: toText(result) }] };
      }
      case 'find_bundle_cumulative_coverage': {
        const result = await this.qualificationService.findBundleCumulativeCoverage(
          args.services as ServiceRequirement[],
          args.filters as QualificationFilters | undefined,
        );
        return { content: [{ type: 'text', text: toText(result) }] };
      }
      case 'get_attestation_details': {
        const result = await this.qualificationService.getAtestadoDetails(args.atestadoId as string);
        return { content: [{ type: 'text', text: toText(result) }] };
      }
      default: {
        const err: McpError = Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
        throw err;
      }
    }
  }

  private errorResponse(
    id: string | number | null | undefined,
    code: number,
    message: string,
  ): Record<string, unknown> {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  }
}
