import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GameRecord } from '../records/game-record.entity';
import { Game } from './game.entity';
import { randomInt } from 'node:crypto';
import { evaluateGuess, generateSecret, validateGuess } from './game-logic';

export const MAX_ATTEMPTS = 100;
// Kullanıcı başına eşzamanlı açık oyun sınırı; sınırsız oyun üretimini engeller.
const MAX_ACTIVE_GAMES = 10;
const MAX_HINTS_PER_GAME = 12;

@Injectable()
export class GamesService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async create(userId: string, digits: number) {
    const repo = this.db.getRepository(Game);
    const active = await repo.countBy({ userId, status: 'active' });
    if (active >= MAX_ACTIVE_GAMES) {
      throw new ConflictException('Çok fazla devam eden oyunun var; önce birini bitir');
    }
    const game = await repo.save(repo.create({ userId, digits, secret: generateSecret(digits) }));
    return { id: game.id, digits, status: game.status, attempts: 0 };
  }

  async guess(userId: string, gameId: string, guess: string) {
    return this.db.transaction(async (manager) => {
      // Satır kilidi: aynı oyuna eşzamanlı tahminler sıraya girer.
      const game = await manager.findOne(Game, {
        where: { id: gameId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!game) throw new NotFoundException('Oyun bulunamadı');
      if (game.status !== 'active') throw new ConflictException('Oyun zaten bitti');

      const error = validateGuess(guess, game.digits);
      if (error) throw new BadRequestException(error);

      const feedback = evaluateGuess(game.secret, guess);
      game.guesses = [...game.guesses, { guess, ...feedback }];
      const attempts = game.guesses.length;
      const won = feedback.plus === game.digits;

      if (won) game.status = 'won';
      else if (attempts >= MAX_ATTEMPTS) game.status = 'lost';
      if (game.status !== 'active') game.finishedAt = new Date();
      await manager.save(game);

      if (won) {
        await manager.save(
          manager.create(GameRecord, { userId, digits: game.digits, attempts }),
        );
      }

      return {
        id: game.id,
        status: game.status,
        attempts,
        feedback,
        ...(game.status !== 'active' && { secret: game.secret }),
      };
    });
  }

  // Gizli sayı sunucuda kaldığı için ipuçları da sunucudan alınır. Altın istemcide tutulduğundan
  // maliyet düşümü şimdilik istemcide; sunucu yalnızca oyun başına ipucu sayısını sınırlar.
  async hint(userId: string, gameId: string, type: 'reveal' | 'eliminate') {
    return this.db.transaction(async (manager) => {
      const game = await manager.findOne(Game, {
        where: { id: gameId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!game) throw new NotFoundException('Oyun bulunamadı');
      if (game.status !== 'active') throw new ConflictException('Oyun zaten bitti');

      const hints = game.hints ?? { revealed: [], eliminated: [] };
      if (hints.revealed.length + hints.eliminated.length >= MAX_HINTS_PER_GAME) {
        throw new ConflictException('Bu oyun için ipucu hakkın bitti');
      }

      let result: { type: 'reveal'; index: number; digit: string } | { type: 'eliminate'; digit: string };
      if (type === 'reveal') {
        const options = [...Array(game.digits).keys()].filter((i) => !hints.revealed.includes(i));
        if (options.length === 0) throw new ConflictException('Açılabilecek bir hane kalmadı');
        const index = options[randomInt(options.length)];
        hints.revealed.push(index);
        result = { type, index, digit: game.secret[index] };
      } else {
        const options = '0123456789'
          .split('')
          .filter((d) => !game.secret.includes(d) && !hints.eliminated.includes(d));
        if (options.length === 0) throw new ConflictException('İşaretlenecek rakam kalmadı');
        const digit = options[randomInt(options.length)];
        hints.eliminated.push(digit);
        result = { type, digit };
      }
      game.hints = hints;
      await manager.save(game);
      return result;
    });
  }

  async get(userId: string, gameId: string) {
    const game = await this.db.getRepository(Game).findOneBy({ id: gameId, userId });
    if (!game) throw new NotFoundException('Oyun bulunamadı');
    return {
      id: game.id,
      digits: game.digits,
      status: game.status,
      attempts: game.guesses.length,
      guesses: game.guesses,
      ...(game.status !== 'active' && { secret: game.secret }),
    };
  }
}
