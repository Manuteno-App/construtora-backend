import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QualificationModule } from '../qualification/qualification.module';
import { McpController } from './mcp.controller';
import { McpAuditLog } from './persistence/entity/mcp-audit-log.entity';

@Module({
  imports: [QualificationModule, TypeOrmModule.forFeature([McpAuditLog])],
  controllers: [McpController],
})
export class McpModule {}
