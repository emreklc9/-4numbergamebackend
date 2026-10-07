import { IsIn, IsInt, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGameDto {
  @IsInt()
  @IsIn([3, 4, 5])
  digits: number;
}

export class GuessDto {
  @IsString()
  @MinLength(3)
  @MaxLength(5)
  guess: string;
}
