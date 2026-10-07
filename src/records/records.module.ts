import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameRecord } from './game-record.entity';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';

@Module({
  imports: [TypeOrmModule.forFeature([GameRecord])],
  controllers: [RecordsController],
  providers: [RecordsService],
})
export class RecordsModule {}
