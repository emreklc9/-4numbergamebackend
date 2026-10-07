import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GameRecord } from '../records/game-record.entity';
import { Game } from './game.entity';
import { evaluateGuess, generateSecret, validateGuess } from './game-logic';

export const MAX_ATTEMPTS = 100;
// Kullanıcı başına eşzamanlı açık oyun sınırı; sınırsız oyun üretimini engeller.
const MAX_ACTIVE_GAMES = 10;

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
