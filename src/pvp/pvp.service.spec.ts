import { applyGold } from '../wallet/wallet.service';
import { PvpService } from './pvp.service';

jest.mock('@nestjs/typeorm', () => ({
  InjectDataSource: () => () => undefined,
  InjectRepository: () => () => undefined,
}));
jest.mock('../wallet/wallet.service', () => ({ applyGold: jest.fn().mockResolvedValue(115) }));

const users = {
  findById: jest.fn(async (id: string) => ({ id, displayName: `P-${id}`, avatarId: 'fox' })),
};
const manager = { insert: jest.fn().mockResolvedValue(undefined) };
const db = { transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(manager)) };

type Event = { userId: string; event: string; payload: any };

function guessesOfFour(): string[] {
  const guesses: string[] = [];
  for (let n = 1023; n < 9877; n++) {
    const guess = String(n);
    if (new Set(guess).size === 4) guesses.push(guess);
  }
  return guesses;
}

function playUntilSolved(service: PvpService): 'a' | 'b' {
  let turn: 'a' | 'b' = 'a';
  for (const guess of guessesOfFour()) {
    const result = service.guess(turn, guess);
    if (result.feedback.plus === 4) return turn;
    turn = turn === 'a' ? 'b' : 'a';
  }
  throw new Error('çözülemedi');
}

function setup() {
  const service = new PvpService(db as any, users as any);
  service.timeoutMs = 30_000;
  service.disconnectMs = 60_000;
  const events: Event[] = [];
  service.setEmitter((userId, event, payload) => events.push({ userId, event, payload }));
  const last = (userId: string, event: string) =>
    [...events].reverse().find((e) => e.userId === userId && e.event === event)?.payload;
  return { service, events, last };
}

describe('PvpService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('ilk oyuncuyu bekletir, ikinciyle eşleştirir', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    expect(last('a', 'queued')).toBeDefined();
    await service.enqueue('b');
    expect(last('a', 'matchStart').opponent.displayName).toBe('P-b');
    expect(last('a', 'matchStart').yourTurn).toBe(true);
    expect(last('b', 'matchStart').yourTurn).toBe(false);
    expect(last('b', 'matchStart').digits).toBe(4);
    expect(service.queueSize()).toBe(0);
    service.shutdown();
  });

  it('aynı oyuncu iki kez kuyruğa girmez', async () => {
    const { service } = setup();
    await service.enqueue('a');
    await service.enqueue('a');
    expect(service.queueSize()).toBe(1);
  });

  it('iptal edilen oyuncu eşleşmez', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    service.dequeue('a');
    await service.enqueue('b');
    expect(last('b', 'matchStart')).toBeUndefined();
    service.shutdown();
  });

  it('geçersiz tahmini reddeder', async () => {
    const { service } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    expect(() => service.guess('a', '1123')).toThrow();
    expect(() => service.guess('b', '1234')).toThrow('Sıra rakibinde');
    expect(() => service.guess('zzz', '1234')).toThrow('Aktif bir maçın yok');
    service.shutdown();
  });

  it('sayıyı bulan kazanır ve altın alır', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    const winner = playUntilSolved(service);
    const loser = winner === 'a' ? 'b' : 'a';
    await jest.runOnlyPendingTimersAsync();
    expect(last(winner, 'matchEnd')).toMatchObject({ result: 'won', reason: 'solved', rewardGold: 15, gold: 115 });
    expect(last(loser, 'matchEnd')).toMatchObject({ result: 'lost' });
    expect(service.hasActiveMatch('a')).toBe(false);
    expect(manager.insert).toHaveBeenCalledTimes(1);
  });

  it('30 sn tahmin etmeyen kaybeder', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    jest.advanceTimersByTime(20_000);
    service.guess('a', '1234');
    await jest.advanceTimersByTimeAsync(31_000);
    expect(last('b', 'matchEnd')).toMatchObject({ result: 'lost', reason: 'idle' });
    expect(last('a', 'matchEnd')).toMatchObject({ result: 'won', reason: 'idle' });
  });

  it('sırası gelmeyenin 30 saniyesi işlemez', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    await jest.advanceTimersByTimeAsync(31_000);
    expect(last('a', 'matchEnd')).toMatchObject({ result: 'lost', reason: 'idle' });
    expect(last('b', 'matchEnd')).toMatchObject({ result: 'won', reason: 'idle' });
  });

  it('maç bitince iki oyuncu yeniden kuyruğa girip eşleşir', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    const firstId = last('a', 'matchStart').matchId;
    playUntilSolved(service);
    await jest.runOnlyPendingTimersAsync();
    await service.enqueue('a');
    expect(service.queueSize()).toBe(1);
    await service.enqueue('b');
    expect(last('b', 'matchStart').matchId).not.toBe(firstId);
    expect(service.hasActiveMatch('a')).toBe(true);
    service.shutdown();
  });

  it('ipucu altın düşer, rakamı açar veya eler', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    const revealed = await service.hint('a', 'reveal');
    const removed = await service.hint('a', 'eliminate');
    expect(revealed.type).toBe('reveal');
    expect(removed.type).toBe('eliminate');
    expect(removed.digit).toMatch(/^\d$/);
    expect(applyGold).toHaveBeenCalledWith(manager, 'a', -1, 'pvp_hint', expect.stringContaining('pvp-hint:'));

    playUntilSolved(service);
    await jest.runOnlyPendingTimersAsync();
    const secret = last('a', 'matchEnd').secret as string;
    if (revealed.type !== 'reveal') throw new Error('reveal');
    expect(secret[revealed.index]).toBe(revealed.digit);
    expect(secret.includes(removed.digit)).toBe(false);
    service.shutdown();
  });

  it('kopan oyuncu 60 sn içinde dönerse maç sürer, dönmezse kaybeder', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    service.setConnected('a', false);
    jest.advanceTimersByTime(20_000);
    expect(() => service.guess('b', '1234')).toThrow('Sıra rakibinde');
    service.setConnected('a', true);
    expect(last('a', 'matchStart').yourTurn).toBe(true);
    expect(service.hasActiveMatch('a')).toBe(true);

    service.setConnected('a', false);
    await jest.advanceTimersByTimeAsync(60_001);
    expect(last('b', 'matchEnd')).toMatchObject({ result: 'won', reason: 'disconnect' });
  });

  it('aynı sayı ile rakip sayısı kuyrukları karışmaz', async () => {
    const { service, last } = setup();
    await service.enqueue('a', 'shared');
    await service.enqueue('b', 'duel');
    expect(last('a', 'matchStart')).toBeUndefined();
    expect(last('b', 'awaitSecret')).toBeUndefined();
    expect(service.queueSize('shared')).toBe(1);
    expect(service.queueSize('duel')).toBe(1);
    service.shutdown();
  });

  it('rakip modunda sayı yazılmadan tahmin edilmez, yazılınca rakibin sayısı tahmin edilir', async () => {
    const { service, last } = setup();
    await service.enqueue('a', 'duel');
    await service.enqueue('b', 'duel');
    expect(last('a', 'awaitSecret').youReady).toBe(false);
    expect(() => service.guess('a', '5678')).toThrow('Önce iki taraf da sayısını yazmalı');
    expect(() => service.submitSecret('a', '0123')).toThrow('İlk rakam 0 olamaz');

    service.submitSecret('a', '1234');
    expect(last('b', 'awaitSecret').opponentReady).toBe(true);
    expect(() => service.guess('a', '5678')).toThrow('Önce iki taraf da sayısını yazmalı');

    service.submitSecret('b', '5678');
    expect(last('a', 'matchStart')).toMatchObject({ yourTurn: true, mode: 'duel' });
    expect(last('b', 'matchStart').yourTurn).toBe(false);

    const miss = service.guess('a', '5679');
    expect(miss.feedback).toMatchObject({ plus: 3, minus: 0 });
    expect(() => service.guess('a', '5678')).toThrow('Sıra rakibinde');

    const hit = service.guess('b', '1234');
    expect(hit.feedback.plus).toBe(4);
    await jest.runOnlyPendingTimersAsync();
    expect(last('b', 'matchEnd')).toMatchObject({ result: 'won', reason: 'solved', secret: '1234' });
    expect(last('a', 'matchEnd')).toMatchObject({ result: 'lost', secret: '5678' });
    service.shutdown();
  });

  it('rakip modunda sayısını yazmayan süre sonunda kaybeder', async () => {
    const { service, last } = setup();
    await service.enqueue('a', 'duel');
    await service.enqueue('b', 'duel');
    await jest.advanceTimersByTimeAsync(31_000);
    expect(last('a', 'matchEnd')).toMatchObject({ result: 'lost', reason: 'idle', stage: 'secret' });
    expect(last('b', 'matchEnd')).toMatchObject({ result: 'won', reason: 'idle', stage: 'secret' });
    service.shutdown();
  });
});
