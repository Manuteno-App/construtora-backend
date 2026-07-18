import { MigrationInterface, QueryRunner } from 'typeorm';

export class IncreaseServicoQuantidadePrecision1760200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE servicos_executados ALTER COLUMN quantidade TYPE numeric(18,6) USING quantidade::numeric(18,6)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE servicos_executados ALTER COLUMN quantidade TYPE numeric(18,4) USING quantidade::numeric(18,4)',
    );
  }
}
