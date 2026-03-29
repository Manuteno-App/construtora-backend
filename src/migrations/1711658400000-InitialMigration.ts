import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialMigration1711658400000 implements MigrationInterface {
  name = 'InitialMigration1711658400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enable pgvector extension
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    // Atestados
    await queryRunner.query(`
      CREATE TYPE atestado_status_enum AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'ERROR')
    `);
    await queryRunner.query(`
      CREATE TABLE atestados (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        s3_key           VARCHAR NOT NULL,
        original_filename VARCHAR NOT NULL,
        status           atestado_status_enum NOT NULL DEFAULT 'PENDING',
        error_message    TEXT,
        created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    // Obras
    await queryRunner.query(`
      CREATE TABLE obras (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        atestado_id  UUID NOT NULL REFERENCES atestados(id) ON DELETE CASCADE,
        nome         VARCHAR NOT NULL,
        local        TEXT,
        tipo         TEXT,
        data_inicio  DATE,
        data_fim     DATE,
        valor        NUMERIC(18,2),
        art          VARCHAR
      )
    `);

    // Empresas
    await queryRunner.query(`
      CREATE TYPE empresa_tipo_enum AS ENUM ('CONTRATANTE', 'CONTRATADA')
    `);
    await queryRunner.query(`
      CREATE TABLE empresas (
        id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome  VARCHAR NOT NULL,
        cnpj  VARCHAR UNIQUE,
        tipo  empresa_tipo_enum
      )
    `);

    // Contratos
    await queryRunner.query(`
      CREATE TABLE contratos (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        obra_id     UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
        empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        numero      VARCHAR,
        data        DATE,
        valor       NUMERIC(18,2)
      )
    `);

    // Servicos Executados
    await queryRunner.query(`
      CREATE TABLE servicos_executados (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        atestado_id  UUID NOT NULL REFERENCES atestados(id) ON DELETE CASCADE,
        obra_id      UUID REFERENCES obras(id) ON DELETE SET NULL,
        trecho       TEXT,
        categoria    VARCHAR,
        codigo       VARCHAR,
        descricao    TEXT NOT NULL,
        unidade      VARCHAR,
        quantidade   NUMERIC(18,4),
        UNIQUE (atestado_id, codigo, trecho)
      )
    `);

    // Chunks
    await queryRunner.query(`
      CREATE TABLE chunks (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        atestado_id       UUID NOT NULL REFERENCES atestados(id) ON DELETE CASCADE,
        original_filename VARCHAR NOT NULL,
        content           TEXT NOT NULL,
        chunk_index       INTEGER NOT NULL,
        page_number       INTEGER
      )
    `);

    // Embeddings — pgvector column
    await queryRunner.query(`
      CREATE TABLE embeddings (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chunk_id  UUID NOT NULL UNIQUE REFERENCES chunks(id) ON DELETE CASCADE,
        vector    vector(1536) NOT NULL,
        metadata  JSONB
      )
    `);

    // Create IVFFlat index for approximate nearest neighbour search
    await queryRunner.query(`
      CREATE INDEX embeddings_vector_idx
        ON embeddings
        USING ivfflat (vector vector_cosine_ops)
        WITH (lists = 100)
    `);

    // Conversation Turns
    await queryRunner.query(`
      CREATE TYPE conversation_role_enum AS ENUM ('USER', 'ASSISTANT')
    `);
    await queryRunner.query(`
      CREATE TABLE conversation_turns (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id  VARCHAR NOT NULL,
        role        conversation_role_enum NOT NULL,
        content     TEXT NOT NULL,
        sources     JSONB,
        created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX conversation_turns_session_created_idx
        ON conversation_turns (session_id, created_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS conversation_turns_session_created_idx`);
    await queryRunner.query(`DROP TABLE IF EXISTS conversation_turns`);
    await queryRunner.query(`DROP TYPE IF EXISTS conversation_role_enum`);
    await queryRunner.query(`DROP INDEX IF EXISTS embeddings_vector_idx`);
    await queryRunner.query(`DROP TABLE IF EXISTS embeddings`);
    await queryRunner.query(`DROP TABLE IF EXISTS chunks`);
    await queryRunner.query(`DROP TABLE IF EXISTS servicos_executados`);
    await queryRunner.query(`DROP TABLE IF EXISTS contratos`);
    await queryRunner.query(`DROP TABLE IF EXISTS empresas`);
    await queryRunner.query(`DROP TYPE IF EXISTS empresa_tipo_enum`);
    await queryRunner.query(`DROP TABLE IF EXISTS obras`);
    await queryRunner.query(`DROP TABLE IF EXISTS atestados`);
    await queryRunner.query(`DROP TYPE IF EXISTS atestado_status_enum`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS vector`);
  }
}
