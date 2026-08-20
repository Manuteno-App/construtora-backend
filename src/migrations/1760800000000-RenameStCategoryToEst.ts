import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameStCategoryToEst1760800000000 implements MigrationInterface {
  name = 'RenameStCategoryToEst1760800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "atestados" SET "categoria" = 'EST' WHERE "categoria" = 'ST'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "atestados" SET "categoria" = 'ST' WHERE "categoria" = 'EST'`,
    );
  }
}
