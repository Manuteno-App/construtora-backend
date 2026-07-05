import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMeasurementsModule1751800000000 implements MigrationInterface {
  name = 'AddMeasurementsModule1751800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE unit_family_status_enum AS ENUM ('ACTIVE', 'INACTIVE');
      CREATE TYPE unit_status_enum AS ENUM ('ACTIVE', 'INACTIVE');
      CREATE TYPE unit_origin_enum AS ENUM ('SYSTEM', 'AI', 'USER');
      CREATE TYPE unit_conversion_type_enum AS ENUM ('MATHEMATICAL');
      CREATE TYPE rule_origin_enum AS ENUM ('SYSTEM', 'AI', 'USER');
      CREATE TYPE technical_unit_conversion_status_enum AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'INACTIVE');
    `);

    await queryRunner.query(`
      CREATE TABLE unit_families (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(120) NOT NULL UNIQUE,
        slug VARCHAR(120) NOT NULL UNIQUE,
        status unit_family_status_enum NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE units (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(120) NOT NULL,
        canonical_symbol VARCHAR(40) NOT NULL UNIQUE,
        normalized_symbol VARCHAR(40) NOT NULL UNIQUE,
        aliases_json TEXT NOT NULL DEFAULT '[]',
        family_id UUID NOT NULL REFERENCES unit_families(id) ON DELETE RESTRICT,
        status unit_status_enum NOT NULL DEFAULT 'ACTIVE',
        origin unit_origin_enum NOT NULL DEFAULT 'SYSTEM',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE unit_conversions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        target_unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        factor NUMERIC(20,10) NOT NULL,
        type unit_conversion_type_enum NOT NULL DEFAULT 'MATHEMATICAL',
        rule_origin rule_origin_enum NOT NULL DEFAULT 'SYSTEM',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (source_unit_id, target_unit_id, type)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE technical_unit_conversions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        service_description TEXT NOT NULL,
        normalized_service_key VARCHAR(255) NOT NULL,
        source_unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        target_unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        factor NUMERIC(20,10) NOT NULL,
        rule_origin rule_origin_enum NOT NULL DEFAULT 'AI',
        status technical_unit_conversion_status_enum NOT NULL DEFAULT 'PENDING',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (normalized_service_key, source_unit_id, target_unit_id)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE service_unit_observations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        atestado_id UUID NOT NULL REFERENCES atestados(id) ON DELETE CASCADE,
        servico_executado_id UUID,
        service_description TEXT NOT NULL,
        normalized_service_key VARCHAR(255) NOT NULL,
        unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        quantidade NUMERIC(18,4),
        raw_unit_symbol VARCHAR(255),
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      ALTER TABLE servicos_executados
        ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS unit_symbol_raw VARCHAR(255),
        ADD COLUMN IF NOT EXISTS normalized_service_key VARCHAR(255);
    `);

    await queryRunner.query(`CREATE INDEX idx_units_family_id ON units(family_id)`);
    await queryRunner.query(`CREATE INDEX idx_technical_unit_conversions_service_key ON technical_unit_conversions(normalized_service_key)`);
    await queryRunner.query(`CREATE INDEX idx_service_unit_observations_service_key ON service_unit_observations(normalized_service_key)`);
    await queryRunner.query(`CREATE INDEX idx_servicos_executados_unit_id ON servicos_executados(unit_id)`);
    await queryRunner.query(`CREATE INDEX idx_servicos_executados_normalized_service_key ON servicos_executados(normalized_service_key)`);

    await queryRunner.query(`
      INSERT INTO unit_families (name, slug, status)
      VALUES
        ('Comprimento', 'comprimento', 'ACTIVE'),
        ('Área', 'area', 'ACTIVE'),
        ('Volume', 'volume', 'ACTIVE'),
        ('Massa', 'massa', 'ACTIVE');
    `);

    await queryRunner.query(`
      INSERT INTO units (name, canonical_symbol, normalized_symbol, aliases_json, family_id, status, origin)
      SELECT seed.name, seed.canonical_symbol, seed.normalized_symbol, seed.aliases_json, f.id, 'ACTIVE', 'SYSTEM'
      FROM (
        VALUES
          ('Milímetro', 'mm', 'mm', '["mm","milimetro","milimetros"]', 'comprimento'),
          ('Centímetro', 'cm', 'cm', '["cm","centimetro","centimetros"]', 'comprimento'),
          ('Metro', 'm', 'm', '["m","metro","metros"]', 'comprimento'),
          ('Quilômetro', 'km', 'km', '["km","quilometro","quilometros"]', 'comprimento'),
          ('Metro quadrado', 'm²', 'm2', '["m2","m²","metroquadrado","metrosquadrados"]', 'area'),
          ('Hectare', 'ha', 'ha', '["ha","hectare","hectares"]', 'area'),
          ('Quilômetro quadrado', 'km²', 'km2', '["km2","km²","quilometroquadrado"]', 'area'),
          ('Litro', 'L', 'l', '["l","lt","litro","litros"]', 'volume'),
          ('Metro cúbico', 'm³', 'm3', '["m3","m³","metrocubico","metroscubicos"]', 'volume'),
          ('Grama', 'g', 'g', '["g","grama","gramas"]', 'massa'),
          ('Quilograma', 'kg', 'kg', '["kg","quilo","quilograma","quilogramas"]', 'massa'),
          ('Tonelada', 't', 't', '["t","ton","tonelada","toneladas"]', 'massa')
      ) AS seed(name, canonical_symbol, normalized_symbol, aliases_json, family_slug)
      INNER JOIN unit_families f ON f.slug = seed.family_slug;
    `);

    await queryRunner.query(`
      INSERT INTO unit_conversions (source_unit_id, target_unit_id, factor, type, rule_origin, is_active)
      SELECT source.id, target.id, seed.factor, 'MATHEMATICAL', 'SYSTEM', true
      FROM (
        VALUES
          ('g', 'kg', 0.001),
          ('kg', 'g', 1000),
          ('kg', 't', 0.001),
          ('t', 'kg', 1000),
          ('mm', 'cm', 0.1),
          ('cm', 'mm', 10),
          ('cm', 'm', 0.01),
          ('m', 'cm', 100),
          ('m', 'km', 0.001),
          ('km', 'm', 1000),
          ('m²', 'ha', 0.0001),
          ('ha', 'm²', 10000),
          ('ha', 'km²', 0.01),
          ('km²', 'ha', 100),
          ('L', 'm³', 0.001),
          ('m³', 'L', 1000)
      ) AS seed(source_symbol, target_symbol, factor)
      INNER JOIN units source ON source.canonical_symbol = seed.source_symbol
      INNER JOIN units target ON target.canonical_symbol = seed.target_symbol;
    `);

    await queryRunner.query(`
      UPDATE servicos_executados s
      SET unit_symbol_raw = s.unidade,
          normalized_service_key = left(
            regexp_replace(
              lower(
                translate(
                  s.descricao,
                  'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
                  'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'
                )
              ),
              '[^a-z0-9]+',
              '-',
              'g'
            ),
            255
          );
    `);

    await queryRunner.query(`
      UPDATE servicos_executados s
      SET unit_id = u.id
      FROM units u
      WHERE lower(replace(replace(coalesce(s.unidade, ''), '²', '2'), '³', '3')) = u.normalized_symbol
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(u.aliases_json::jsonb) alias
           WHERE alias = lower(replace(replace(coalesce(s.unidade, ''), '²', '2'), '³', '3'))
         );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_servicos_executados_normalized_service_key`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_servicos_executados_unit_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_service_unit_observations_service_key`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_technical_unit_conversions_service_key`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_units_family_id`);

    await queryRunner.query(`
      ALTER TABLE servicos_executados
        DROP COLUMN IF EXISTS normalized_service_key,
        DROP COLUMN IF EXISTS unit_symbol_raw,
        DROP COLUMN IF EXISTS unit_id;
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS service_unit_observations`);
    await queryRunner.query(`DROP TABLE IF EXISTS technical_unit_conversions`);
    await queryRunner.query(`DROP TABLE IF EXISTS unit_conversions`);
    await queryRunner.query(`DROP TABLE IF EXISTS units`);
    await queryRunner.query(`DROP TABLE IF EXISTS unit_families`);

    await queryRunner.query(`DROP TYPE IF EXISTS technical_unit_conversion_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS rule_origin_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS unit_conversion_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS unit_origin_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS unit_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS unit_family_status_enum`);
  }
}
