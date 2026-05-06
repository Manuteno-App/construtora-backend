import {
    Body,
    ConflictException,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { Public } from '../../../../common/decorators/public.decorator';
import { AuthService } from '../../core/service/auth.service';
import { UserEntity } from '../../persistence/entity/user.entity';
import { AuthenticatedUser } from '../../public-api/interface/auth.interface';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginDto } from './dto/login.dto';

const REFRESH_TOKEN_COOKIE = 'refresh_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('local'))
  @ApiBody({ type: LoginDto })
  @ApiOperation({ summary: 'Autenticar usuário e obter tokens' })
  async login(
    @Req() req: Request & { user: UserEntity },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const { accessToken, refreshToken } = await this.authService.login(req.user);
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken, COOKIE_OPTIONS);
    return { accessToken, user: this.authService.toPublic(req.user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar access token usando refresh token cookie' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const token: string | undefined = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!token) {
      res.status(HttpStatus.UNAUTHORIZED).json({ message: 'Refresh token ausente' });
      return { accessToken: '' };
    }
    const tokens = await this.authService.refresh(token);
    return tokens;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerrar sessão e limpar cookie' })
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
  }

  @Get('me')
  @ApiOperation({ summary: 'Retornar dados do usuário autenticado' })
  me(@Req() req: Request & { user: AuthenticatedUser }): AuthenticatedUser {
    return req.user;
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ type: CreateUserDto })
  @ApiOperation({ summary: 'Criar novo usuário (requer autenticação)' })
  async createUser(@Body() dto: CreateUserDto): Promise<AuthenticatedUser> {
    try {
      return await this.authService.createUser(dto.email, dto.name, dto.password);
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg?.code === '23505') {
        throw new ConflictException('E-mail já cadastrado');
      }
      throw err;
    }
  }
}
