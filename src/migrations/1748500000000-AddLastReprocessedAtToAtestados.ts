import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLastReprocessedAtToAtestados1748500000000 implements MigrationInterface {
  name = 'AddLastReprocessedAtToAtestados1748500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "atestados" ADD COLUMN IF NOT EXISTS "last_reprocessed_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "atestados" DROP COLUMN IF EXISTS "last_reprocessed_at"`,
    );
  }
}
