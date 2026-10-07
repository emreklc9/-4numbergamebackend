import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User } from '../users/user.entity';
import { DigitsQueryDto, OfflineBatchDto } from './dto/records.dto';
import { RecordsService } from './records.service';

@Controller()
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('records')
  mine(@CurrentUser() user: User) {
    return this.records.mine(user.id);
  }

  // Çevrimdışı oynanan oyunların toplu yüklemesi; kayıtlar "doğrulanmamış" işaretlenir.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('records/offline')
  offline(@CurrentUser() user: User, @Body() dto: OfflineBatchDto) {
    return this.records.addOfflineBatch(user.id, dto.records);
  }

  @Get('leaderboard')
  leaderboard(@Query() query: DigitsQueryDto) {
    return this.records.leaderboard(query.digits);
  }
}
