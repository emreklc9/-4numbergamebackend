import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User } from '../users/user.entity';
import { DigitsQueryDto } from './dto/records.dto';
import { RecordsService } from './records.service';

@Controller()
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @UseGuards(JwtAuthGuard)
  @Get('records')
  mine(@CurrentUser() user: User) {
    return this.records.mine(user.id);
  }

  @Get('leaderboard')
  leaderboard(@Query() query: DigitsQueryDto) {
    return this.records.leaderboard(query.digits);
  }
}
