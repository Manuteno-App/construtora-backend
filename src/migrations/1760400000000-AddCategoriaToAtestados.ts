import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoriaToAtestados1760400000000 implements MigrationInterface {
  name = 'AddCategoriaToAtestados1760400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "atestados" ADD COLUMN IF NOT EXISTS "categoria" TEXT',
    );
    await queryRunner.query(`
      UPDATE "atestados"
      SET "categoria" = CASE
        WHEN "original_filename" ~* '^\\s*(ST|EST)(\\s*-|\\s+|_|\\.|$)' THEN 'EST'
        WHEN "original_filename" ~* '^\\s*CIV(\\s*-|\\s+|_|\\.|$)' THEN 'CIV'
        WHEN "original_filename" ~* '^\\s*SAN(\\s*-|\\s+|_|\\.|$)' THEN 'SAN'
        WHEN "original_filename" ~* '^\\s*INS(\\s*-|\\s+|_|\\.|$)' THEN 'INS'
        ELSE NULL
      END
      WHERE "categoria" IS NULL
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_atestados_categoria" ON "atestados" ("categoria")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_atestados_categoria"');
    await queryRunner.query('ALTER TABLE "atestados" DROP COLUMN IF EXISTS "categoria"');
  }
}
