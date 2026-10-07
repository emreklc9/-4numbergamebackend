import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameRecord } from '../records/game-record.entity';
import { Game } from './game.entity';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [TypeOrmModule.forFeature([Game, GameRecord])],
  controllers: [GamesController],
  providers: [GamesService],
})
export class GamesModule {}
