import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Atestado } from './entities/atestado.entity';
import { Obra } from './entities/obra.entity';
import { Empresa } from './entities/empresa.entity';
import { Contrato } from './entities/contrato.entity';
import { ServicoExecutado } from './entities/servico-executado.entity';
import { Chunk } from './entities/chunk.entity';
import { Embedding } from './entities/embedding.entity';
import { ConversationTurn } from './entities/conversation-turn.entity';

export const ALL_ENTITIES = [
  Atestado,
  Obra,
  Empresa,
  Contrato,
  ServicoExecutado,
  Chunk,
  Embedding,
  ConversationTurn,
];

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('databaseUrl'),
        entities: ALL_ENTITIES,
        synchronize: false,
        migrations: ['dist/migrations/*.js'],
        migrationsRun: false,
        logging: config.get<string>('nodeEnv') === 'development',
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
