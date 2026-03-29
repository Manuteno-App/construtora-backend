import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Atestado } from '../database/entities/atestado.entity';
import { ServicoExecutado } from '../database/entities/servico-executado.entity';
import { AtestadosController } from './atestados.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([Atestado, ServicoExecutado]), StorageModule],
  controllers: [AtestadosController],
})
export class AtestadosModule {}
