import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { Atestado } from './src/modules/documents/persistence/entity/atestado.entity';
import { Chunk } from './src/modules/ingestion/persistence/entity/chunk.entity';
import { Embedding } from './src/modules/indexing/persistence/entity/embedding.entity';
import { Obra } from './src/modules/extraction/persistence/entity/obra.entity';
import { Empresa } from './src/modules/extraction/persistence/entity/empresa.entity';
import { Contrato } from './src/modules/extraction/persistence/entity/contrato.entity';
import { ServicoExecutado } from './src/modules/extraction/persistence/entity/servico-executado.entity';
import { ConversationTurn } from './src/modules/intelligence/persistence/entity/conversation-turn.entity';

dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Atestado, Chunk, Embedding, Obra, Empresa, Contrato, ServicoExecutado, ConversationTurn],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});

export default AppDataSource;
