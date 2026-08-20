import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServicoSemanticEmbedding1760400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS vector');
    await queryRunner.query(
      'ALTER TABLE servicos_executados ADD COLUMN IF NOT EXISTS semantic_embedding vector(1536)',
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS servicos_executados_semantic_embedding_idx
       ON servicos_executados USING ivfflat (semantic_embedding vector_cosine_ops)
       WITH (lists = 100)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS servicos_executados_semantic_embedding_idx');
    await queryRunner.query('ALTER TABLE servicos_executados DROP COLUMN IF EXISTS semantic_embedding');
  }
}
