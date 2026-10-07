import { Type } from 'class-transformer';
import { IsIn, IsInt } from 'class-validator';

export class DigitsQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([3, 4, 5])
  digits: number = 4;
}
