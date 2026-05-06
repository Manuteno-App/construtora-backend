import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

export class SeedAdminUser1746489600001 implements MigrationInterface {
  name = 'SeedAdminUser1746489600001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    const name = process.env.ADMIN_NAME ?? 'Administrador';

    if (!email || !password) {
      console.warn('[SeedAdminUser] ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping seed.');
      return;
    }

    const [existing] = await queryRunner.query(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    );
    if (existing) {
      console.log('[SeedAdminUser] Admin user already exists, skipping.');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await queryRunner.query(
      `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)`,
      [email, name, passwordHash],
    );
    console.log(`[SeedAdminUser] Admin user created: ${email}`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const email = process.env.ADMIN_EMAIL;
    if (email) {
      await queryRunner.query(`DELETE FROM users WHERE email = $1`, [email]);
    }
  }
}
