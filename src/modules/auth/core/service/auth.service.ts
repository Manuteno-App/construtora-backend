import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRepository } from '../../persistence/repository/user.repository';
import { AuthTokens, AuthenticatedUser, JwtPayload } from '../../public-api/interface/auth.interface';
import { UserEntity } from '../../persistence/entity/user.entity';

@Injectable()
export class AuthService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiration: string;
  private readonly refreshExpiration: string;

  constructor(
    private readonly userRepository: UserRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.accessSecret = this.configService.get<string>('jwt.accessSecret')!;
    this.refreshSecret = this.configService.get<string>('jwt.refreshSecret')!;
    this.accessExpiration = this.configService.get<string>('jwt.accessExpiration') ?? '15m';
    this.refreshExpiration = this.configService.get<string>('jwt.refreshExpiration') ?? '7d';
  }

  async validateUser(email: string, password: string): Promise<UserEntity> {
    const user = await this.userRepository.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return user;
  }

  async login(user: UserEntity): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: JwtPayload = { sub: user.id, email: user.email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.accessSecret,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expiresIn: this.accessExpiration as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.refreshSecret,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expiresIn: this.refreshExpiration as any,
      }),
    ]);
    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    const user = await this.userRepository.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email } satisfies JwtPayload,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { secret: this.accessSecret, expiresIn: this.accessExpiration as any },
    );
    return { accessToken };
  }

  async createUser(email: string, name: string, password: string): Promise<AuthenticatedUser> {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.userRepository.createUser({ email, name, passwordHash });
    return { id: user.id, email: user.email, name: user.name };
  }

  toPublic(user: UserEntity): AuthenticatedUser {
    return { id: user.id, email: user.email, name: user.name };
  }
}
