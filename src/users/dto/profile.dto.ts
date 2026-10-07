import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AVATAR_IDS } from '../avatars';

export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  displayName?: string;

  @IsOptional()
  @IsIn(AVATAR_IDS)
  avatarId?: string;
}
