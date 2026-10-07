import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User } from '../users/user.entity';
import { ItemDto } from './dto/wallet.dto';
import { WalletService } from './wallet.service';

@UseGuards(JwtAuthGuard)
@Controller('store')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  state(@CurrentUser() user: User) {
    return this.wallet.state(user.id);
  }

  @Post('purchase')
  purchase(@CurrentUser() user: User, @Body() dto: ItemDto) {
    return this.wallet.purchase(user.id, dto.itemId);
  }

  @Put('equip')
  equip(@CurrentUser() user: User, @Body() dto: ItemDto) {
    return this.wallet.equip(user.id, dto.itemId);
  }
}
