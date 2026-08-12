import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMcpAuditLogs1760600000000 implements MigrationInterface {
  name = 'CreateMcpAuditLogs1760600000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS mcp_audit_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NULL, tool_name VARCHAR NOT NULL, arguments JSONB NOT NULL, success BOOLEAN NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS mcp_audit_logs_created_at_idx ON mcp_audit_logs(created_at DESC)`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS mcp_audit_logs_created_at_idx`);
    await queryRunner.query(`DROP TABLE IF EXISTS mcp_audit_logs`);
  }
}
