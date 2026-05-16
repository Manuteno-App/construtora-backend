import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServicosExecutadosTSV1747500000000 implements MigrationInterface {
  name = 'AddServicosExecutadosTSV1747500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE servicos_executados
        ADD COLUMN IF NOT EXISTS descricao_tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(descricao, ''))) STORED
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS servicos_executados_descricao_tsv_idx
        ON servicos_executados
        USING gin(descricao_tsv)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS servicos_executados_descricao_tsv_idx`);
    await queryRunner.query(`ALTER TABLE servicos_executados DROP COLUMN IF EXISTS descricao_tsv`);
  }
}
