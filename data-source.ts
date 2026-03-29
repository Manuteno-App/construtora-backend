import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { ALL_ENTITIES } from './src/modules/database/database.module';

dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ALL_ENTITIES,
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});

export default AppDataSource;
