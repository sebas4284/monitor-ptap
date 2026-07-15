import { Body, Controller, Inject, Post, Req, UsePipes } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type LoginResult } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto, loginSchema } from './dto/login.dto';
import { ZodValidationPipe } from '../../infrastructure/validation/zod-validation.pipe';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() dto: LoginDto, @Req() request: Request): Promise<LoginResult> {
    const ip = request.ip ?? request.socket.remoteAddress ?? null;
    return this.authService.login(dto.email, dto.password, { ip });
  }
}
