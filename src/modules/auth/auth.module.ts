import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './core/service/auth.service';
import { JwtStrategy } from './core/strategy/jwt.strategy';
import { LocalStrategy } from './core/strategy/local.strategy';
import { AuthController } from './http/rest/auth.controller';
import { UserEntity } from './persistence/entity/user.entity';
import { UserRepository } from './persistence/repository/user.repository';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    TypeOrmModule.forFeature([UserEntity]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LocalStrategy, UserRepository],
  exports: [AuthService, UserRepository],
})
export class AuthModule {}
