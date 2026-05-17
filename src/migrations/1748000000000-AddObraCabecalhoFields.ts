import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddObraCabecalhoFields1748000000000 implements MigrationInterface {
  name = 'AddObraCabecalhoFields1748000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "cidade" TEXT`);
    await queryRunner.query(`ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "estado" VARCHAR(2)`);
    await queryRunner.query(`ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "data_atestado" DATE`);
    await queryRunner.query(`ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "engenheiro" TEXT`);
    await queryRunner.query(`ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "valor_atestado" NUMERIC(18,2)`);
    await queryRunner.query(`ALTER TABLE "obras" ADD COLUMN IF NOT EXISTS "cliente" TEXT`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "obras" DROP COLUMN IF EXISTS "cliente"`);
    await queryRunner.query(`ALTER TABLE "obras" DROP COLUMN IF EXISTS "valor_atestado"`);
    await queryRunner.query(`ALTER TABLE "obras" DROP COLUMN IF EXISTS "engenheiro"`);
    await queryRunner.query(`ALTER TABLE "obras" DROP COLUMN IF EXISTS "data_atestado"`);
    await queryRunner.query(`ALTER TABLE "obras" DROP COLUMN IF EXISTS "estado"`);
    await queryRunner.query(`ALTER TABLE "obras" DROP COLUMN IF EXISTS "cidade"`);
  }
}
