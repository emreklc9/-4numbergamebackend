import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { evaluateGuess, generateSecret, validateGuess, type Feedback } from '../games/game-logic';
import { UsersService } from '../users/users.service';
import { applyGold } from '../wallet/wallet.service';
import { PVP_DIGITS, PVP_TIMEOUT_MS, PVP_WIN_GOLD } from './pvp.constants';
import { PvpEndReason, PvpMatch } from './pvp-match.entity';

type Player = {
  userId: string;
  displayName: string;
  avatarId: string;
  attempts: number;
  connected: boolean;
  idleTimer?: NodeJS.Timeout;
  dropTimer?: NodeJS.Timeout;
};

type Match = {
  id: string;
  secret: string;
  digits: number;
  players: [Player, Player];
  finished: boolean;
};

export type PvpError = { code: string; message: string };
export type Emit = (userId: string, event: string, payload: unknown) => void;

@Injectable()
export class PvpService {
  private readonly logger = new Logger(PvpService.name);
  private emit: Emit = () => undefined;
  private readonly queue: string[] = [];
  private readonly matches = new Map<string, Match>();
  private readonly byUser = new Map<string, Match>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly users: UsersService,
  ) {}

  // Testlerde kısaltılabilsin diye alan olarak tutulur.
  timeoutMs = PVP_TIMEOUT_MS;

  setEmitter(emit: Emit) {
    this.emit = emit;
  }

  async enqueue(userId: string): Promise<void> {
    const existing = this.byUser.get(userId);
    if (existing) {
      this.sendStart(existing, userId);
      return;
    }
    if (this.queue.includes(userId)) return;

    const opponentId = this.queue.shift();
    if (!opponentId) {
      this.queue.push(userId);
      this.emit(userId, 'queued', {});
      return;
    }
    const [first, second] = await Promise.all([
      this.users.findById(opponentId),
      this.users.findById(userId),
    ]);
    if (!first || !second) {
      // Kuyruktaki oyuncu hesabını kaybettiyse yenisi beklemeye alınır.
      if (second) this.queue.push(userId);
      return;
    }
    const match: Match = {
      id: randomUUID(),
      secret: generateSecret(PVP_DIGITS),
      digits: PVP_DIGITS,
      finished: false,
      players: [first, second].map((user) => ({
        userId: user.id,
        displayName: user.displayName,
        avatarId: user.avatarId,
        attempts: 0,
        connected: true,
      })) as [Player, Player],
    };
    this.matches.set(match.id, match);
    for (const player of match.players) {
      this.byUser.set(player.userId, match);
      this.armIdle(match, player);
      this.sendStart(match, player.userId);
    }
  }

  dequeue(userId: string) {
    const index = this.queue.indexOf(userId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  guess(userId: string, guess: string): { feedback: Feedback; attempts: number } {
    const match = this.byUser.get(userId);
    if (!match || match.finished) throw this.error('NO_MATCH', 'Aktif bir maçın yok');
    const message = validateGuess(guess, match.digits);
    if (message) throw this.error('INVALID_GUESS', message);

    const me = this.playerOf(match, userId);
    const other = this.opponentOf(match, userId);
    me.attempts++;
    const feedback = evaluateGuess(match.secret, guess);
    this.armIdle(match, me);
    this.emit(other.userId, 'opponentProgress', { attempts: me.attempts });

    if (feedback.plus === match.digits) void this.finish(match, userId, 'solved');
    return { feedback, attempts: me.attempts };
  }

  setConnected(userId: string, connected: boolean) {
    this.dequeueIfOffline(userId, connected);
    const match = this.byUser.get(userId);
    if (!match || match.finished) return;
    const me = this.playerOf(match, userId);
    me.connected = connected;
    clearTimeout(me.dropTimer);
    if (connected) {
      this.armIdle(match, me);
      this.sendStart(match, userId);
      this.emit(this.opponentOf(match, userId).userId, 'opponentConnection', { connected: true });
      return;
    }
    // Kopukken yalnızca bağlantı süresi işler; tahmin bekleme süresi dönüşte yeniden başlar.
    clearTimeout(me.idleTimer);
    this.emit(this.opponentOf(match, userId).userId, 'opponentConnection', {
      connected: false,
      graceMs: this.timeoutMs,
    });
    me.dropTimer = setTimeout(
      () => void this.finish(match, this.opponentOf(match, userId).userId, 'disconnect'),
      this.timeoutMs,
    );
  }

  hasActiveMatch(userId: string) {
    return this.byUser.has(userId);
  }

  queueSize() {
    return this.queue.length;
  }

  // Test ve kapanış temizliği için.
  shutdown() {
    for (const match of this.matches.values()) this.clearTimers(match);
    this.matches.clear();
    this.byUser.clear();
    this.queue.length = 0;
  }

  private dequeueIfOffline(userId: string, connected: boolean) {
    if (!connected) this.dequeue(userId);
  }

  private async finish(match: Match, winnerId: string, reason: PvpEndReason) {
    if (match.finished) return;
    match.finished = true;
    this.clearTimers(match);
    this.matches.delete(match.id);
    for (const player of match.players) this.byUser.delete(player.userId);

    const [p1, p2] = match.players;
    let gold: number | null = null;
    try {
      gold = await this.db.transaction(async (manager) => {
        await manager.insert(PvpMatch, {
          id: match.id,
          player1Id: p1.userId,
          player2Id: p2.userId,
          winnerId,
          digits: match.digits,
          secret: match.secret,
          reason,
          player1Attempts: p1.attempts,
          player2Attempts: p2.attempts,
        });
        return applyGold(manager, winnerId, PVP_WIN_GOLD, 'pvp_win', `pvp:${match.id}`);
      });
    } catch (error) {
      this.logger.error(`PVP maçı kaydedilemedi: ${match.id}`, error as Error);
    }

    for (const player of match.players) {
      const won = player.userId === winnerId;
      this.emit(player.userId, 'matchEnd', {
        result: won ? 'won' : 'lost',
        reason,
        secret: match.secret,
        attempts: player.attempts,
        opponentAttempts: this.opponentOf(match, player.userId).attempts,
        ...(won && { rewardGold: PVP_WIN_GOLD, gold }),
      });
    }
  }

  private armIdle(match: Match, player: Player) {
    clearTimeout(player.idleTimer);
    player.idleTimer = setTimeout(
      () => void this.finish(match, this.opponentOf(match, player.userId).userId, 'idle'),
      this.timeoutMs,
    );
  }

  private clearTimers(match: Match) {
    for (const player of match.players) {
      clearTimeout(player.idleTimer);
      clearTimeout(player.dropTimer);
    }
  }

  private sendStart(match: Match, userId: string) {
    const me = this.playerOf(match, userId);
    const other = this.opponentOf(match, userId);
    this.emit(userId, 'matchStart', {
      matchId: match.id,
      digits: match.digits,
      timeoutMs: this.timeoutMs,
      attempts: me.attempts,
      opponent: {
        displayName: other.displayName,
        avatarId: other.avatarId,
        attempts: other.attempts,
        connected: other.connected,
      },
    });
  }

  private playerOf(match: Match, userId: string) {
    return match.players.find((player) => player.userId === userId)!;
  }

  private opponentOf(match: Match, userId: string) {
    return match.players.find((player) => player.userId !== userId)!;
  }

  private error(code: string, message: string): PvpError & Error {
    return Object.assign(new Error(message), { code });
  }
}
