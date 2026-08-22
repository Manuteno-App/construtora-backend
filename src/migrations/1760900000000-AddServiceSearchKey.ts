import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddServiceSearchKey1760900000000 implements MigrationInterface {
  name = 'AddServiceSearchKey1760900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await queryRunner.query(
      'ALTER TABLE servicos_executados ADD COLUMN IF NOT EXISTS search_service_key VARCHAR(255)',
    );
    await queryRunner.query(`
      UPDATE servicos_executados
      SET search_service_key = left(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(translate(
                descricao,
                'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
                'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'
              )),
              '[^a-z0-9]+', ' ', 'g'
            ),
            '(^| )(a|as|com|da|das|de|do|dos|e|em|na|nas|no|nos|o|os|para|por|um|uma)( |$)',
            '\\1', 'g'
          ),
          '[^a-z0-9]+', '', 'g'
        ),
        255
      )
      WHERE search_service_key IS NULL;
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_servicos_executados_search_service_key_trgm ON servicos_executados USING gin (search_service_key gin_trgm_ops)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_servicos_executados_search_service_key_trgm',
    );
    await queryRunner.query(
      'ALTER TABLE servicos_executados DROP COLUMN IF EXISTS search_service_key',
    );
  }
}
