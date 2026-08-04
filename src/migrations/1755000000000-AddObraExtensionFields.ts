import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddObraExtensionFields1755000000000 implements MigrationInterface {
  name = 'AddObraExtensionFields1755000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "numero_atestado" TEXT');
    await queryRunner.query('ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "extensao_declarada_km" NUMERIC(14,4)');
    await queryRunner.query('ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "km_inicial" NUMERIC(14,4)');
    await queryRunner.query('ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "km_final" NUMERIC(14,4)');
    await queryRunner.query('ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "extensao_calculada_km" NUMERIC(14,4)');
    await queryRunner.query('ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "extensao_km" NUMERIC(14,4)');
    await queryRunner.query('CREATE INDEX IF NOT EXISTS "IDX_obras_extensao_km" ON "obras" ("extensao_km")');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_obras_extensao_km"');
    await queryRunner.query('ALTER TABLE "obras" DROP COLUMN IF EXISTS "extensao_km"');
    await queryRunner.query('ALTER TABLE "obras" DROP COLUMN IF EXISTS "extensao_calculada_km"');
    await queryRunner.query('ALTER TABLE "obras" DROP COLUMN IF EXISTS "km_final"');
    await queryRunner.query('ALTER TABLE "obras" DROP COLUMN IF EXISTS "km_inicial"');
    await queryRunner.query('ALTER TABLE "obras" DROP COLUMN IF EXISTS "extensao_declarada_km"');
    await queryRunner.query('ALTER TABLE "obras" DROP COLUMN IF EXISTS "numero_atestado"');
  }
}
