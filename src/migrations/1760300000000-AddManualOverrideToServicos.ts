import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddManualOverrideToServicos1760300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE servicos_executados ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT false',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE servicos_executados DROP COLUMN IF EXISTS manual_override');
  }
}
