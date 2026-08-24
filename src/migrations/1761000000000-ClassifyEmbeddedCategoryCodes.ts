import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Older files could have their category code after a descriptive prefix, such
 * as "Atestado EST - Rodovia.pdf". Classify those records with the same
 * separator-aware rule used for newly uploaded and renamed documents.
 */
export class ClassifyEmbeddedCategoryCodes1761000000000 implements MigrationInterface {
  name = 'ClassifyEmbeddedCategoryCodes1761000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "atestados"
      SET "categoria" = CASE
        WHEN "original_filename" ~* '(^|[[:space:]_.-])(ST|EST)([[:space:]_.-]|$)' THEN 'EST'
        WHEN "original_filename" ~* '(^|[[:space:]_.-])CIV([[:space:]_.-]|$)' THEN 'CIV'
        WHEN "original_filename" ~* '(^|[[:space:]_.-])SAN([[:space:]_.-]|$)' THEN 'SAN'
        WHEN "original_filename" ~* '(^|[[:space:]_.-])INS([[:space:]_.-]|$)' THEN 'INS'
        ELSE "categoria"
      END
      WHERE "categoria" IS NULL
        AND "original_filename" ~* '(^|[[:space:]_.-])(ST|EST|CIV|SAN|INS)([[:space:]_.-]|$)'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "atestados"
      SET "categoria" = NULL
      WHERE "categoria" IN ('EST', 'CIV', 'SAN', 'INS')
        AND "original_filename" !~* '^\\s*(ST|EST|CIV|SAN|INS)(\\s*-|\\s+|_|\\.|$)'
        AND "original_filename" ~* '(^|[[:space:]_.-])(ST|EST|CIV|SAN|INS)([[:space:]_.-]|$)'
    `);
  }
}
