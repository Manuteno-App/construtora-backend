import { Module } from '@nestjs/common';
import { QualificationModule } from '../qualification/qualification.module';
import { McpController } from './mcp.controller';

@Module({
  imports: [QualificationModule],
  controllers: [McpController],
})
export class McpModule {}
