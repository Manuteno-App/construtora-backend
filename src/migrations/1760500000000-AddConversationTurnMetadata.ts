import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationTurnMetadata1760500000000 implements MigrationInterface {
  name = 'AddConversationTurnMetadata1760500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversation_turns ADD COLUMN IF NOT EXISTS metadata JSONB`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE conversation_turns DROP COLUMN IF EXISTS metadata`);
  }
}
