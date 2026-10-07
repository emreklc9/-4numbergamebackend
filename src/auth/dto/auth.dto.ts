import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  displayName?: string;
}

export class LoginDto {
  @Transform(normalizeEmail)
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(72)
  password: string;
}

export class GoogleLoginDto {
  @IsString()
  @MaxLength(4096)
  idToken: string;
}

export class GuestDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  displayName?: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refreshToken: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(72)
  currentPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(72)
  newPassword: string;
}
