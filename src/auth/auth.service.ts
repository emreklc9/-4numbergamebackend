import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { GuestDto, LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;
// Kullanıcı yoksa da bcrypt çalıştırılır; böylece yanıt süresi e-posta varlığını sızdırmaz.
const DUMMY_HASH = bcrypt.hashSync('dummy-password', BCRYPT_ROUNDS);

@Injectable()
export class AuthService {
  private readonly google = new OAuth2Client();

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async guest(dto: GuestDto) {
    const suffix = Math.random().toString(36).slice(2, 7);
    const user = await this.users.save({
      isGuest: true,
      displayName: dto.displayName ?? `Misafir-${suffix}`,
    });
    return this.session(user);
  }

  async register(dto: RegisterDto) {
    if (await this.users.findByEmailWithPassword(dto.email)) {
      throw new ConflictException('Bu e-posta zaten kayıtlı');
    }
    const user = await this.users.save({
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      displayName: dto.displayName ?? dto.email.split('@')[0].slice(0, 30),
      isGuest: false,
    });
    return this.session(user);
  }

  // Misafir hesabı e-posta/şifreye dönüştürür; rekorlar aynı kullanıcıda kalır.
  async upgrade(current: User, dto: RegisterDto) {
    if (!current.isGuest) throw new ConflictException('Hesap zaten kayıtlı');
    if (await this.users.findByEmailWithPassword(dto.email)) {
      throw new ConflictException('Bu e-posta zaten kayıtlı');
    }
    const user = await this.users.save({
      id: current.id,
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      displayName: dto.displayName ?? current.displayName,
      isGuest: false,
    });
    return this.session(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmailWithPassword(dto.email);
    const ok = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('E-posta veya şifre hatalı');
    return this.session(user);
  }

  // Google kimlik belirteci sunucuda doğrulanır; istemciden parola alınmaz.
  async googleLogin(idToken: string, current?: User) {
    // Web, Android ve iOS istemci kimlikleri virgülle ayrılarak verilebilir.
    const clientIds = this.config
      .getOrThrow<string>('GOOGLE_CLIENT_ID')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    let payload;
    try {
      const ticket = await this.google.verifyIdToken({ idToken, audience: clientIds });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('Geçersiz Google belirteci');
    }
    if (!payload?.sub || !payload.email || !payload.email_verified) {
      throw new UnauthorizedException('Google e-postası doğrulanmamış');
    }
    const email = payload.email.toLowerCase();

    let user = await this.users.findByGoogleId(payload.sub);
    if (!user) {
      const byEmail = await this.users.findByEmail(email);
      if (current?.isGuest && !byEmail) {
        // Misafir hesabı Google hesabına dönüştürülür; rekorlar korunur.
        user = await this.users.save({ id: current.id, email, googleId: payload.sub, isGuest: false });
      } else if (byEmail) {
        // E-posta/şifre kaydında e-posta doğrulanmadığı için eski şifre silinir;
        // aksi halde e-postayı önceden kaydeden biri hesabı ele geçirebilirdi.
        user = await this.users.save({ id: byEmail.id, googleId: payload.sub, passwordHash: null });
      } else {
        user = await this.users.save({
          email,
          googleId: payload.sub,
          displayName: (payload.name ?? email.split('@')[0]).slice(0, 30),
          isGuest: false,
        });
      }
    }
    return this.session(user);
  }

  private async session(user: User) {
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }),
      user: this.publicUser(user),
    };
  }

  publicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isGuest: user.isGuest,
    };
  }
}
