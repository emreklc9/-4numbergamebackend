import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class DigitsQueryDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([3, 4, 5])
  digits: number = 4;
}

export class OfflineRecordDto {
  @IsUUID()
  clientId: string;

  @IsInt()
  @IsIn([3, 4, 5])
  digits: number;

  @IsInt()
  @Min(1)
  @Max(100)
  attempts: number;

  @IsDateString()
  playedAt: string;
}

export class OfflineBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OfflineRecordDto)
  records: OfflineRecordDto[];
}
