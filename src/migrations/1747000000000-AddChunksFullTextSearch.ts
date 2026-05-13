import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChunksFullTextSearch1747000000000 implements MigrationInterface {
  name = 'AddChunksFullTextSearch1747000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add generated tsvector column using the Portuguese dictionary.
    // GENERATED ALWAYS AS ... STORED is automatically kept in sync with content.
    await queryRunner.query(`
      ALTER TABLE chunks
        ADD COLUMN IF NOT EXISTS content_tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED
    `);

    // GIN index for efficient full-text search
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS chunks_content_tsv_idx
        ON chunks
        USING gin(content_tsv)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS chunks_content_tsv_idx`);
    await queryRunner.query(`ALTER TABLE chunks DROP COLUMN IF EXISTS content_tsv`);
  }
}
