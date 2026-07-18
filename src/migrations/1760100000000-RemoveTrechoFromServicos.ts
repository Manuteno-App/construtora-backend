import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTrechoFromServicos1760100000000 implements MigrationInterface {
  name = 'RemoveTrechoFromServicos1760100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE servicos_executados DROP COLUMN IF EXISTS trecho');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE servicos_executados ADD COLUMN IF NOT EXISTS trecho TEXT');
  }
}
