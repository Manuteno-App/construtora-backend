import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { UserRepository } from '../../modules/auth/persistence/repository/user.repository';
import { AuthenticatedUser, JwtPayload } from '../../modules/auth/public-api/interface/auth.interface';

type PortalUserResponse = {
  user_id?: number | string;
  id?: number | string;
  username?: string;
  email?: string;
  name?: string;
  admin?: boolean;
  privileges?: number[];
};

export type RequestUser = AuthenticatedUser & {
  source: 'construtora' | 'portal';
  privileges?: number[];
  isAdmin?: boolean;
};

@Injectable()
export class JwtAuthGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const token = this.bearerToken(request);

    const localUser = await this.tryLocalJwt(token);
    if (localUser) {
      request.user = localUser;
      return true;
    }

    request.user = await this.validatePortalToken(token);
    return true;
  }

  private bearerToken(request: Request): string {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de acesso ausente ou inválido');
    }
    const token = authorization.slice('Bearer '.length).trim();
    if (!token) throw new UnauthorizedException('Token de acesso ausente ou inválido');
    return token;
  }

  private async tryLocalJwt(token: string): Promise<RequestUser | null> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('jwt.accessSecret'),
      });
      const user = await this.userRepository.findById(payload.sub);
      if (!user) return null;
      return { id: user.id, email: user.email, name: user.name, source: 'construtora' };
    } catch {
      return null;
    }
  }

  private async validatePortalToken(token: string): Promise<RequestUser> {
    const baseUrl = this.configService.get<string>('manutenoApiBaseUrl');
    if (!baseUrl) throw new UnauthorizedException('Token de acesso inválido');

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new ServiceUnavailableException('Não foi possível validar a sessão do Portal');
    }

    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException('Token de acesso inválido');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('Não foi possível validar a sessão do Portal');
    }

    const portalUser = (await response.json()) as PortalUserResponse;
    if (portalUser.admin !== true) {
      throw new ForbiddenException('Acesso restrito a administradores do Portal');
    }

    const id = portalUser.user_id ?? portalUser.id;
    const email = portalUser.email ?? portalUser.username;
    if (id === undefined || !email) throw new UnauthorizedException('Resposta de autenticação inválida');

    return {
      id: String(id),
      email,
      name: portalUser.name ?? email,
      source: 'portal',
      isAdmin: true,
      privileges: portalUser.privileges ?? [],
    };
  }
}
