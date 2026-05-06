import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1746489600000 implements MigrationInterface {
  name = 'CreateUsersTable1746489600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email         VARCHAR NOT NULL UNIQUE,
        name          VARCHAR NOT NULL,
        password_hash VARCHAR NOT NULL,
        created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE users`);
  }
}
