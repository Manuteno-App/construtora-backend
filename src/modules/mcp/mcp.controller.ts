import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import {
  BundleEvaluationRequest,
  IQualificationApi,
  QUALIFICATION_API,
} from '../qualification/public-api/interface/qualification-api.interface';
import { McpAuditLog } from './persistence/entity/mcp-audit-log.entity';

const PROTOCOL_VERSION = '2024-11-05';
const TOOLS = [
  {
    name: 'evaluate_bundle',
    description: 'Avalia requisitos de habilitação com exatamente a mesma política da página de edital.',
    inputSchema: {
      type: 'object',
      required: ['bundleMode', 'services'],
      properties: {
        bundleMode: { type: 'string', enum: ['ONE', 'MANY', 'MAX'] },
        maxAtestados: { type: 'number' },
        services: { type: 'array', items: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, minQuantidade: { type: 'number' }, unidade: { type: 'string' }, proofMode: { type: 'string', enum: ['ONE', 'MANY', 'MAX'] }, maxAtestados: { type: 'number' } } } },
        filters: { type: 'object' },
      },
    },
  },
  {
    name: 'resolve_service_descriptions',
    description: 'Resolve descrições conhecidas de serviços para revisão antes de uma análise.',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
  },
];

interface McpMessage { jsonrpc: '2.0'; method?: string; params?: unknown; id?: string | number | null }

@ApiTags('mcp')
@Controller('mcp')
export class McpController {
  constructor(
    @Inject(QUALIFICATION_API) private readonly qualification: IQualificationApi,
    @InjectRepository(McpAuditLog) private readonly auditLogs: Repository<McpAuditLog>,
  ) {}

  /**
   * Guarded by the application's global JWT guard. MCP is an external adapter,
   * never the transport used by the in-process chat.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticated MCP JSON-RPC endpoint for qualification tools' })
  async handle(@Body() message: McpMessage | McpMessage[], @Req() request: Request & { user?: { id: string } }) {
    if (Array.isArray(message)) return Promise.all(message.map((item) => this.process(item, request.user?.id)));
    return this.process(message, request.user?.id);
  }

  private async process(message: McpMessage, userId?: string): Promise<Record<string, unknown> | null> {
    if (message.id === undefined || message.id === null) return null;
    try {
      let result: unknown;
      switch (message.method) {
        case 'initialize': result = { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'construtora-qualification', version: '2.0.0' } }; break;
        case 'initialized': case 'ping': result = {}; break;
        case 'tools/list': result = { tools: TOOLS }; break;
        case 'tools/call': result = await this.call(message.params as { name: string; arguments: Record<string, unknown> }, userId); break;
        default: return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
      }
      return { jsonrpc: '2.0', id: message.id, result };
    } catch (error) {
      return { jsonrpc: '2.0', id: message.id, error: { code: -32602, message: (error as Error).message || 'Invalid tool request' } };
    }
  }

  private async call(params: { name: string; arguments: Record<string, unknown> }, userId?: string) {
    try {
      let data: unknown;
      if (params.name === 'evaluate_bundle') data = await this.qualification.evaluateBundlePolicy(params.arguments as unknown as BundleEvaluationRequest);
      else if (params.name === 'resolve_service_descriptions') data = await this.qualification.resolveDescricoes(String(params.arguments.query ?? ''));
      else throw new Error('Unknown tool');
      await this.auditLogs.save(this.auditLogs.create({ userId, toolName: params.name, arguments: params.arguments, success: true }));
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    } catch (error) {
      await this.auditLogs.save(this.auditLogs.create({ userId, toolName: params.name, arguments: params.arguments ?? {}, success: false }));
      throw error;
    }
  }
}
