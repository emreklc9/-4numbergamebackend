import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { PvpGateway } from './pvp.gateway';
import { PvpMatch } from './pvp-match.entity';
import { PvpService } from './pvp.service';

@Module({
  imports: [TypeOrmModule.forFeature([PvpMatch]), UsersModule, JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }),
    }),
  ],
  providers: [PvpService, PvpGateway],
})
export class PvpModule {}
