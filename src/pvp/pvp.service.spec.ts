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

function setup() {
  const service = new PvpService(db as any, users as any);
  service.timeoutMs = 60_000;
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
    expect(() => service.guess('zzz', '1234')).toThrow('Aktif bir maçın yok');
    service.shutdown();
  });

  it('sayıyı bulan kazanır ve altın alır', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    const all: string[] = [];
    for (let n = 1023; n < 9877; n++) {
      const s = String(n);
      if (new Set(s).size === 4) all.push(s);
    }
    for (const g of all) if (service.guess('a', g).feedback.plus === 4) break;
    await jest.runOnlyPendingTimersAsync();
    expect(last('a', 'matchEnd')).toMatchObject({ result: 'won', reason: 'solved', rewardGold: 15, gold: 115 });
    expect(last('b', 'matchEnd')).toMatchObject({ result: 'lost' });
    expect(service.hasActiveMatch('a')).toBe(false);
    expect(manager.insert).toHaveBeenCalledTimes(1);
  });

  it('60 sn tahmin etmeyen kaybeder', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    jest.advanceTimersByTime(30_000);
    service.guess('a', '1234');
    await jest.advanceTimersByTimeAsync(31_000);
    expect(last('b', 'matchEnd')).toMatchObject({ result: 'lost', reason: 'idle' });
    expect(last('a', 'matchEnd')).toMatchObject({ result: 'won', reason: 'idle' });
  });

  it('kopan oyuncu 60 sn içinde dönerse maç sürer, dönmezse kaybeder', async () => {
    const { service, last } = setup();
    await service.enqueue('a');
    await service.enqueue('b');
    service.setConnected('a', false);
    jest.advanceTimersByTime(40_000);
    service.setConnected('a', true);
    expect(last('a', 'matchStart')).toBeDefined();
    expect(service.hasActiveMatch('a')).toBe(true);

    service.setConnected('a', false);
    service.guess('b', '1234');
    await jest.advanceTimersByTimeAsync(60_001);
    expect(last('b', 'matchEnd')).toMatchObject({ result: 'won', reason: 'disconnect' });
  });
});
