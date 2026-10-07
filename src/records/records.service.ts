import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GoldTransaction } from '../wallet/gold-transaction.entity';
import { OFFLINE_DAILY_GOLD_CAP, winReward } from '../wallet/wallet.constants';
import { applyGold, currentGold } from '../wallet/wallet.service';
import { GameRecord } from './game-record.entity';
import { OfflineRecordDto, OfflineSpendDto } from './dto/records.dto';

@Injectable()
export class RecordsService {
  constructor(
    @InjectRepository(GameRecord) private readonly repo: Repository<GameRecord>,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  async mine(userId: string, digits?: number) {
    const records = await this.repo.find({
      where: digits ? { userId, digits } : { userId },
      order: { digits: 'ASC', attempts: 'ASC', createdAt: 'ASC' },
      take: 20,
    });
    return records.map((r) => ({
      id: r.id,
      digits: r.digits,
      attempts: r.attempts,
      date: r.playedAt ?? r.createdAt,
      verified: r.verified,
    }));
  }

  // Çevrimdışı rekorlar doğrulanmamış saklanır; aynı clientId ikinci kez işlenmez.
  // Kazanılan altın günlük sınırla kısılır, harcamalar bakiyeyi 0'ın altına indirmez.
  async addOfflineBatch(userId: string, records: OfflineRecordDto[], spends: OfflineSpendDto[]) {
    if (records.length + spends.length === 0) {
      throw new BadRequestException('Gönderilecek kayıt yok');
    }
    return this.db.transaction(async (manager) => {
      const now = Date.now();
      const dayStart = new Date();
      dayStart.setUTCHours(0, 0, 0, 0);
      const { earned } = await manager
        .createQueryBuilder(GoldTransaction, 't')
        .select('COALESCE(SUM(t.delta), 0)', 'earned')
        .where('t.user_id = :userId AND t.reason = :reason AND t.created_at >= :dayStart', {
          userId,
          reason: 'offline_win',
          dayStart,
        })
        .getRawOne();
      let budget = Math.max(OFFLINE_DAILY_GOLD_CAP - Number(earned), 0);

      let accepted = 0;
      for (const item of records) {
        const playedAt = new Date(item.playedAt).getTime();
        const row = manager.create(GameRecord, {
          userId,
          digits: item.digits,
          attempts: item.attempts,
          clientId: item.clientId,
          verified: false,
          // Gelecek tarihli zaman damgası kabul edilmez.
          playedAt: new Date(Math.min(Number.isNaN(playedAt) ? now : playedAt, now)),
        });
        const result = await manager.createQueryBuilder().insert().into(GameRecord).values(row).orIgnore().execute();
        if (!result.identifiers.some(Boolean)) continue;
        accepted++;
        const reward = Math.min(winReward(item.attempts), budget);
        if (reward > 0) {
          budget -= reward;
          await applyGold(manager, userId, reward, 'offline_win', `rec:${item.clientId}`, false);
        }
      }
      for (const spend of spends) {
        await applyGold(manager, userId, -spend.amount, 'offline_spend', `spend:${spend.clientId}`, false);
      }
      return { received: records.length + spends.length, accepted, gold: await currentGold(manager, userId) };
    });
  }

  // Her oyuncunun o moddaki en iyi (en az tahminli) sonucu.
  async leaderboard(digits: number, limit = 50) {
    const rows = await this.repo
      .createQueryBuilder('r')
      .innerJoin('r.user', 'u')
      .select('u.id', 'userId')
      .addSelect('u.display_name', 'displayName')
      .addSelect('MIN(r.attempts)', 'bestAttempts')
      .addSelect('MIN(r.created_at)', 'firstAchievedAt')
      .where('r.digits = :digits AND r.verified = true', { digits })
      .groupBy('u.id')
      .orderBy('"bestAttempts"', 'ASC')
      .addOrderBy('"firstAchievedAt"', 'ASC')
      .limit(limit)
      .getRawMany();
    return rows.map((row, i) => ({
      rank: i + 1,
      displayName: row.displayName,
      attempts: Number(row.bestAttempts),
    }));
  }
}
