import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomInt, randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { evaluateGuess, generateSecret, validateGuess, type Feedback } from '../games/game-logic';
import { UsersService } from '../users/users.service';
import { ELIMINATE_HINT_COST, REVEAL_HINT_COST } from '../wallet/wallet.constants';
import { applyGold } from '../wallet/wallet.service';
import { PVP_DIGITS, PVP_DISCONNECT_MS, PVP_IDLE_MS, PVP_WIN_GOLD } from './pvp.constants';
import { PvpEndReason, PvpMatch } from './pvp-match.entity';

const MAX_HINTS = 12;

export type PvpMode = 'shared' | 'duel';

type Player = {
  userId: string;
  displayName: string;
  avatarId: string;
  attempts: number;
  connected: boolean;
  secret: string | null;
  revealed: number[];
  eliminated: string[];
  hintBusy: boolean;
  idleTimer?: NodeJS.Timeout;
  dropTimer?: NodeJS.Timeout;
};

export type PvpHint =
  | { type: 'reveal'; index: number; digit: string; gold: number }
  | { type: 'eliminate'; digit: string; gold: number };

type Match = {
  id: string;
  mode: PvpMode;
  phase: 'secrets' | 'playing';
  secret: string;
  digits: number;
  players: [Player, Player];
  turnUserId: string;
  finished: boolean;
};

export type PvpError = { code: string; message: string };
export type Emit = (userId: string, event: string, payload: unknown) => void;

@Injectable()
export class PvpService {
  private readonly logger = new Logger(PvpService.name);
  private emit: Emit = () => undefined;
  private readonly queues: Record<PvpMode, string[]> = { shared: [], duel: [] };
  private readonly matches = new Map<string, Match>();
  private readonly byUser = new Map<string, Match>();

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly users: UsersService,
  ) {}

  // Testlerde kısaltılabilsin diye alan olarak tutulur.
  timeoutMs = PVP_IDLE_MS;
  disconnectMs = PVP_DISCONNECT_MS;

  setEmitter(emit: Emit) {
    this.emit = emit;
  }

  async enqueue(userId: string, mode: PvpMode = 'shared'): Promise<void> {
    const existing = this.byUser.get(userId);
    if (existing) {
      if (existing.phase === 'secrets') this.sendAwait(existing, userId);
      else this.sendStart(existing, userId);
      return;
    }
    if (this.queues.shared.includes(userId) || this.queues.duel.includes(userId)) return;

    const queue = this.queues[mode];
    const opponentId = queue.shift();
    if (!opponentId) {
      queue.push(userId);
      this.emit(userId, 'queued', { mode });
      return;
    }
    const [first, second] = await Promise.all([
      this.users.findById(opponentId),
      this.users.findById(userId),
    ]);
    if (!first || !second) {
      // Kuyruktaki oyuncu hesabını kaybettiyse yenisi beklemeye alınır.
      if (second) queue.push(userId);
      return;
    }
    const toPlayer = (user: { id: string; displayName: string; avatarId: string }): Player => ({
      userId: user.id,
      displayName: user.displayName,
      avatarId: user.avatarId,
      attempts: 0,
      connected: true,
      secret: null,
      revealed: [],
      eliminated: [],
      hintBusy: false,
    });
    const duel = mode === 'duel';
    const match: Match = {
      id: randomUUID(),
      mode,
      phase: duel ? 'secrets' : 'playing',
      secret: duel ? '' : generateSecret(PVP_DIGITS),
      digits: PVP_DIGITS,
      finished: false,
      // Kuyrukta bekleyen oyuncu ilk sırayı alır. Süre yalnızca sırası gelende işler.
      turnUserId: duel ? '' : first.id,
      players: [toPlayer(first), toPlayer(second)],
    };
    this.matches.set(match.id, match);
    for (const player of match.players) {
      this.byUser.set(player.userId, match);
      if (duel) {
        this.armIdle(match, player);
        this.sendAwait(match, player.userId);
      } else if (player.userId === match.turnUserId) {
        this.armIdle(match, player);
        this.sendStart(match, player.userId);
      } else {
        this.sendStart(match, player.userId);
      }
    }
  }

  dequeue(userId: string) {
    for (const queue of Object.values(this.queues)) {
      const index = queue.indexOf(userId);
      if (index >= 0) queue.splice(index, 1);
    }
  }

  submitSecret(userId: string, secret: string) {
    const match = this.byUser.get(userId);
    if (!match || match.finished) throw this.error('NO_MATCH', 'Aktif bir maçın yok');
    if (match.mode !== 'duel' || match.phase !== 'secrets') {
      throw this.error('NOT_READY', 'Şu an sayı yazılmıyor');
    }
    const message = validateGuess(secret, match.digits);
    if (message) throw this.error('INVALID_GUESS', message);
    if (secret.startsWith('0')) throw this.error('INVALID_GUESS', 'İlk rakam 0 olamaz');

    const me = this.playerOf(match, userId);
    if (me.secret) throw this.error('ALREADY_SET', 'Sayını zaten yazdın');
    me.secret = secret;
    clearTimeout(me.idleTimer);

    const other = this.opponentOf(match, userId);
    if (!other.secret) {
      this.sendAwait(match, userId);
      this.sendAwait(match, other.userId);
      return;
    }
    this.beginPlay(match);
  }

  guess(userId: string, guess: string): { feedback: Feedback; attempts: number } {
    const match = this.byUser.get(userId);
    if (!match || match.finished) throw this.error('NO_MATCH', 'Aktif bir maçın yok');
    const message = validateGuess(guess, match.digits);
    if (message) throw this.error('INVALID_GUESS', message);
    if (match.phase !== 'playing') throw this.error('NOT_READY', 'Önce iki taraf da sayısını yazmalı');
    if (match.turnUserId !== userId) throw this.error('NOT_YOUR_TURN', 'Sıra rakibinde');

    const me = this.playerOf(match, userId);
    const other = this.opponentOf(match, userId);
    me.attempts++;
    const feedback = evaluateGuess(this.targetSecret(match, userId), guess);
    clearTimeout(me.idleTimer);
    this.emit(other.userId, 'opponentProgress', { attempts: me.attempts });

    if (feedback.plus === match.digits) {
      void this.finish(match, userId, 'solved');
      return { feedback, attempts: me.attempts };
    }

    match.turnUserId = other.userId;
    this.armIdle(match, other);
    this.emitTurn(match);
    return { feedback, attempts: me.attempts };
  }

  // İpucu yalnızca isteyen oyuncuya döner. Altın, maç hâlâ sürüyorsa düşer.
  async hint(userId: string, type: 'reveal' | 'eliminate'): Promise<PvpHint> {
    const match = this.byUser.get(userId);
    if (!match || match.finished) throw this.error('NO_MATCH', 'Aktif bir maçın yok');
    if (match.phase !== 'playing') throw this.error('NOT_READY', 'Önce iki taraf da sayısını yazmalı');
    if (match.turnUserId !== userId) throw this.error('NOT_YOUR_TURN', 'Sıra rakibinde');
    const me = this.playerOf(match, userId);
    if (me.hintBusy) throw this.error('BUSY', 'İpucu işleniyor');
    me.hintBusy = true;
    try {
      const cost = type === 'reveal' ? REVEAL_HINT_COST : ELIMINATE_HINT_COST;
      const used = me.revealed.length + me.eliminated.length;
      if (used >= MAX_HINTS) throw this.error('NO_HINT', 'Bu maç için ipucu hakkın bitti');

      const pending = this.pickHint(match, me, type);
      const ref = `pvp-hint:${match.id}:${userId}:${used + 1}`;
      const gold = await this.db.transaction(async (manager) => {
        const next = await applyGold(manager, userId, -cost, 'pvp_hint', ref);
        if (next === null) throw this.error('NO_HINT', 'İpucu zaten kullanıldı');
        return next;
      });

      if (match.finished || !this.byUser.has(userId)) {
        await this.db.transaction((manager) =>
          applyGold(manager, userId, cost, 'pvp_hint_refund', `${ref}:refund`, false),
        );
        throw this.error('NO_MATCH', 'Aktif bir maçın yok');
      }

      if (pending.type === 'reveal') me.revealed.push(pending.index);
      else me.eliminated.push(pending.digit);
      return { ...pending, gold };
    } finally {
      me.hintBusy = false;
    }
  }

  setConnected(userId: string, connected: boolean) {
    this.dequeueIfOffline(userId, connected);
    const match = this.byUser.get(userId);
    if (!match || match.finished) return;
    const me = this.playerOf(match, userId);
    me.connected = connected;
    clearTimeout(me.dropTimer);
    if (connected) {
      if (match.phase === 'secrets') {
        if (!me.secret) this.armIdle(match, me);
        this.sendAwait(match, userId);
      } else {
        if (match.turnUserId === userId) this.armIdle(match, me);
        this.sendStart(match, userId);
      }
      this.emit(this.opponentOf(match, userId).userId, 'opponentConnection', { connected: true });
      return;
    }
    // Kopukken yalnızca bağlantı süresi işler; tahmin bekleme süresi dönüşte yeniden başlar.
    clearTimeout(me.idleTimer);
    this.emit(this.opponentOf(match, userId).userId, 'opponentConnection', {
      connected: false,
      graceMs: this.disconnectMs,
    });
    me.dropTimer = setTimeout(
      () => void this.finish(match, this.opponentOf(match, userId).userId, 'disconnect'),
      this.disconnectMs,
    );
  }

  hasActiveMatch(userId: string) {
    return this.byUser.has(userId);
  }

  queueSize(mode: PvpMode = 'shared') {
    return this.queues[mode].length;
  }

  // Test ve kapanış temizliği için.
  shutdown() {
    for (const match of this.matches.values()) this.clearTimers(match);
    this.matches.clear();
    this.byUser.clear();
    this.queues.shared.length = 0;
    this.queues.duel.length = 0;
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
    const stage = match.phase === 'secrets' ? 'secret' : 'guess';
    const storedSecret = match.mode === 'duel' ? `${p1.secret ?? ''}:${p2.secret ?? ''}` : match.secret;
    let gold: number | null = null;
    try {
      gold = await this.db.transaction(async (manager) => {
        await manager.insert(PvpMatch, {
          id: match.id,
          player1Id: p1.userId,
          player2Id: p2.userId,
          winnerId,
          digits: match.digits,
          secret: storedSecret,
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
      const shown =
        match.mode === 'duel' ? (this.opponentOf(match, player.userId).secret ?? '') : storedSecret;
      this.emit(player.userId, 'matchEnd', {
        result: won ? 'won' : 'lost',
        reason,
        stage,
        secret: shown,
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
      hints: {
        revealed: me.revealed.map((index) => ({ index, digit: this.targetSecret(match, userId)[index] })),
        eliminated: [...me.eliminated],
      },
      yourTurn: match.turnUserId === userId,
      mode: match.mode,
    });
  }

  private sendAwait(match: Match, userId: string) {
    const me = this.playerOf(match, userId);
    const other = this.opponentOf(match, userId);
    this.emit(userId, 'awaitSecret', {
      matchId: match.id,
      digits: match.digits,
      timeoutMs: this.timeoutMs,
      mode: match.mode,
      youReady: me.secret !== null,
      opponentReady: other.secret !== null,
      opponent: {
        displayName: other.displayName,
        avatarId: other.avatarId,
        attempts: other.attempts,
        connected: other.connected,
      },
    });
  }

  private beginPlay(match: Match) {
    match.phase = 'playing';
    match.turnUserId = match.players[0].userId;
    for (const player of match.players) {
      if (player.userId === match.turnUserId) this.armIdle(match, player);
      this.sendStart(match, player.userId);
    }
  }

  private targetSecret(match: Match, userId: string) {
    if (match.mode === 'shared') return match.secret;
    return this.opponentOf(match, userId).secret ?? '';
  }

  private emitTurn(match: Match) {
    for (const player of match.players) {
      this.emit(player.userId, 'turn', {
        yourTurn: match.turnUserId === player.userId,
        timeoutMs: this.timeoutMs,
      });
    }
  }

  private pickHint(match: Match, me: Player, type: 'reveal' | 'eliminate') {
    const secret = this.targetSecret(match, me.userId);
    if (type === 'reveal') {
      const options = [...Array(match.digits).keys()].filter((index) => !me.revealed.includes(index));
      if (options.length === 0) throw this.error('NO_HINT', 'Açılabilecek bir hane kalmadı');
      const index = options[randomInt(options.length)];
      return { type, index, digit: secret[index] } as const;
    }
    const options = '0123456789'
      .split('')
      .filter((digit) => !secret.includes(digit) && !me.eliminated.includes(digit));
    if (options.length === 0) throw this.error('NO_HINT', 'İşaretlenecek rakam kalmadı');
    return { type, digit: options[randomInt(options.length)] } as const;
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
