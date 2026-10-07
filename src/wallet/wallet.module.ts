import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoldTransaction } from './gold-transaction.entity';
import { UserStore } from './user-store.entity';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [TypeOrmModule.forFeature([GoldTransaction, UserStore])],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
