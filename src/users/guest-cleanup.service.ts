import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const DAY_MS = 24 * 60 * 60 * 1000;

// Uzun süredir kullanılmayan misafir hesaplarını (ve tüm verilerini) siler. Son kullanım, hesabın
// oluşturulma anı ile yenileme anahtarlarının son kullanımının en yenisidir.
@Injectable()
export class GuestCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GuestCleanupService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.retentionDays <= 0) return;
    // Açılıştan kısa süre sonra, ardından günde bir.
    setTimeout(() => void this.run(), 60_000).unref();
    this.timer = setInterval(() => void this.run(), DAY_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private get retentionDays() {
    return this.config.get<number>('GUEST_RETENTION_DAYS', 180);
  }

  async run(retentionDays = this.retentionDays): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
    try {
      return await this.db.transaction(async (manager) => {
        const stale: Array<{ id: string }> = await manager.query(
          `SELECT u.id FROM users u
           WHERE u.is_guest = true AND u.email IS NULL AND u.google_id IS NULL
             AND GREATEST(
               u.created_at,
               COALESCE((SELECT MAX(GREATEST(t.created_at, t.last_used_at))
                         FROM refresh_tokens t WHERE t.user_id = u.id), u.created_at)
             ) < $1
           LIMIT 1000`,
          [cutoff],
        );
        if (stale.length === 0) return 0;
        const ids = stale.map((row) => row.id);
        // Oyunlar ve rekorlar FK ile silinir; diğer tablolarda FK olmadığından açıkça temizlenir.
        await manager.query('DELETE FROM gold_transactions WHERE user_id = ANY($1)', [ids]);
        await manager.query('DELETE FROM pvp_matches WHERE player1_id = ANY($1) OR player2_id = ANY($1)', [ids]);
        await manager.query('DELETE FROM user_stores WHERE user_id = ANY($1)', [ids]);
        await manager.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [ids]);
        await manager.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
        this.logger.log(`${ids.length} hareketsiz misafir hesabı silindi (>${retentionDays} gün)`);
        return ids.length;
      });
    } catch (error) {
      this.logger.error('Misafir temizliği başarısız', error as Error);
      return 0;
    }
  }
}
