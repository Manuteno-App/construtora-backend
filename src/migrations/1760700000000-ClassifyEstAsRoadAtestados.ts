import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassifyEstAsRoadAtestados1760700000000 implements MigrationInterface {
  name = 'ClassifyEstAsRoadAtestados1760700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "atestados"
      SET "categoria" = 'EST'
      WHERE "categoria" IS NULL
        AND "original_filename" ~* '^\\s*EST(\\s*-|\\s+|_|\\.|$)'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "atestados"
      SET "categoria" = NULL
      WHERE "categoria" = 'EST'
        AND "original_filename" ~* '^\\s*EST(\\s*-|\\s+|_|\\.|$)'
    `);
  }
}
