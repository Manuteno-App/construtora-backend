import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExtractionAuditToServicos1760000000000 implements MigrationInterface {
  name = 'AddExtractionAuditToServicos1760000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE servicos_executados DROP CONSTRAINT IF EXISTS "UQ_servico_atestado_codigo_trecho"`);
    await queryRunner.query(`ALTER TABLE servicos_executados DROP CONSTRAINT IF EXISTS "servicos_executados_atestado_id_codigo_trecho_key"`);
    await queryRunner.query(`
      ALTER TABLE servicos_executados
        ADD COLUMN IF NOT EXISTS item_key VARCHAR(512),
        ADD COLUMN IF NOT EXISTS quantidade_raw VARCHAR(255),
        ADD COLUMN IF NOT EXISTS extraction_method VARCHAR(32),
        ADD COLUMN IF NOT EXISTS extraction_version VARCHAR(32),
        ADD COLUMN IF NOT EXISTS baixa_confianca BOOLEAN NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE servicos_executados
        ADD CONSTRAINT servicos_executados_atestado_item_key_uq UNIQUE (atestado_id, item_key)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE servicos_executados DROP CONSTRAINT IF EXISTS servicos_executados_atestado_item_key_uq`);
    await queryRunner.query(`ALTER TABLE servicos_executados DROP COLUMN IF EXISTS item_key, DROP COLUMN IF EXISTS quantidade_raw, DROP COLUMN IF EXISTS extraction_method, DROP COLUMN IF EXISTS extraction_version, DROP COLUMN IF EXISTS baixa_confianca`);
  }
}
