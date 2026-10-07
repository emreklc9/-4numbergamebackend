import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { IsNull, Repository } from 'typeorm';
import { OAuth2Client } from 'google-auth-library';
import * as bcrypt from 'bcryptjs';
import { UpdateProfileDto } from '../users/dto/profile.dto';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { RefreshToken } from './refresh-token.entity';
import { GuestDto, LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_ROUNDS = 12;
// Kullanıcı yoksa da bcrypt çalıştırılır; böylece yanıt süresi e-posta varlığını sızdırmaz.
// Kayıtlı hesaplarda yenileme anahtarı her kullanımda bu kadar uzar; misafirde süresizdir.
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const DUMMY_HASH = bcrypt.hashSync('dummy-password', BCRYPT_ROUNDS);

@Injectable()
export class AuthService {
  private readonly google = new OAuth2Client();

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  async guest(dto: GuestDto) {
    const user = await this.users.save({
      isGuest: true,
      displayName: dto.displayName ?? `Guest${randomInt(100000, 1000000)}`,
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
    const refreshToken = randomBytes(32).toString('base64url');
    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: user.isGuest ? null : new Date(Date.now() + REFRESH_TTL_MS),
      }),
    );
    // Hesap dönüşümünde (misafir → kayıtlı) eski süresiz anahtarlar iptal edilir.
    if (!user.isGuest) {
      await this.refreshTokens.update(
        { userId: user.id, revokedAt: IsNull(), expiresAt: IsNull() },
        { revokedAt: new Date() },
      );
    }
    return { ...(await this.accessSession(user)), refreshToken };
  }

  private async accessSession(user: User) {
    return {
      accessToken: await this.jwt.signAsync({ sub: user.id }),
      user: this.publicUser(user),
    };
  }

  // Anahtar döndürülmez: yanıt yolda kaybolsa bile istemci eski anahtarla devam edebilir.
  async refresh(refreshToken: string) {
    const token = await this.refreshTokens.findOneBy({ tokenHash: hashToken(refreshToken) });
    const invalid = new UnauthorizedException('Oturum geçersiz, tekrar giriş yap');
    if (!token || token.revokedAt) throw invalid;
    if (token.expiresAt && token.expiresAt.getTime() < Date.now()) throw invalid;
    const user = await this.users.findById(token.userId);
    if (!user) throw invalid;
    // Kayıtlı hesapta süresiz anahtar olmamalı (dönüşümde iptal edilir); olursa reddedilir.
    if (!user.isGuest && !token.expiresAt) throw invalid;

    await this.refreshTokens.update(token.id, {
      lastUsedAt: new Date(),
      ...(user.isGuest ? {} : { expiresAt: new Date(Date.now() + REFRESH_TTL_MS) }),
    });
    return this.accessSession(user);
  }

  async logout(refreshToken: string) {
    await this.refreshTokens.update(
      { tokenHash: hashToken(refreshToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { ok: true };
  }

  async updateProfile(user: User, dto: UpdateProfileDto) {
    await this.users.save({
      id: user.id,
      ...(dto.displayName !== undefined && { displayName: dto.displayName }),
      ...(dto.avatarId !== undefined && { avatarId: dto.avatarId }),
    });
    return this.publicUser(await this.users.findById(user.id) as User);
  }

  publicUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarId: user.avatarId,
      isGuest: user.isGuest,
    };
  }
}
