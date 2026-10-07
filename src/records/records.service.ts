import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameRecord } from './game-record.entity';

@Injectable()
export class RecordsService {
  constructor(@InjectRepository(GameRecord) private readonly repo: Repository<GameRecord>) {}

  async mine(userId: string, digits?: number) {
    const records = await this.repo.find({
      where: digits ? { userId, digits } : { userId },
      order: { digits: 'ASC', attempts: 'ASC', createdAt: 'ASC' },
      take: 20,
    });
    return records.map((r) => ({ id: r.id, digits: r.digits, attempts: r.attempts, date: r.createdAt }));
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
      .where('r.digits = :digits', { digits })
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
