import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { User } from '../users/user.entity';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { GoogleLoginDto, GuestDto, LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';
import { UpdateProfileDto } from '../users/dto/profile.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('guest')
  guest(@Body() dto: GuestDto) {
    return this.auth.guest(dto);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('google')
  google(@Body() dto: GoogleLoginDto) {
    return this.auth.googleLogin(dto.idToken);
  }

  // Misafir oturumuyla çağrılırsa misafir hesabı Google hesabına bağlanır.
  @UseGuards(JwtAuthGuard)
  @Post('google/link')
  googleLink(@CurrentUser() user: User, @Body() dto: GoogleLoginDto) {
    return this.auth.googleLogin(dto.idToken, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('upgrade')
  upgrade(@CurrentUser() user: User, @Body() dto: RegisterDto) {
    return this.auth.upgrade(user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.auth.publicUser(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateProfile(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user, dto);
  }
}
