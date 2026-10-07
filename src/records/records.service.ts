import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameRecord } from './game-record.entity';
import { OfflineRecordDto } from './dto/records.dto';

@Injectable()
export class RecordsService {
  constructor(@InjectRepository(GameRecord) private readonly repo: Repository<GameRecord>) {}

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

  // Çevrimdışı rekorlar doğrulanmamış olarak saklanır. Tekrar gönderimler clientId ile yok sayılır.
  async addOfflineBatch(userId: string, items: OfflineRecordDto[]) {
    const now = Date.now();
    const rows = items.map((item) => {
      const playedAt = new Date(item.playedAt).getTime();
      // Gelecek tarihli zaman damgası kabul edilmez; geçmişe ait değer olduğu gibi tutulur.
      return this.repo.create({
        userId,
        digits: item.digits,
        attempts: item.attempts,
        clientId: item.clientId,
        verified: false,
        playedAt: new Date(Math.min(Number.isNaN(playedAt) ? now : playedAt, now)),
      });
    });
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .values(rows)
      .orIgnore()
      .execute();
    return { received: items.length, accepted: result.identifiers.filter(Boolean).length };
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
