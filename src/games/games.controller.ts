import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User } from '../users/user.entity';
import { CreateGameDto, GuessDto, HintDto } from './dto/games.dto';
import { GamesService } from './games.service';

@UseGuards(JwtAuthGuard)
@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateGameDto) {
    return this.games.create(user.id, dto.digits);
  }

  @Get(':id')
  get(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.games.get(user.id, id);
  }

  @Post(':id/guesses')
  guess(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GuessDto,
  ) {
    return this.games.guess(user.id, id, dto.guess);
  }

  @Post(':id/hints')
  hint(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HintDto) {
    return this.games.hint(user.id, id, dto.type);
  }
}
