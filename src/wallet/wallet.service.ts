import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { User } from '../users/user.entity';
import { GoldTransaction } from './gold-transaction.entity';
import { UserStore } from './user-store.entity';
import { CATALOG, DEFAULT_EQUIPPED, DEFAULT_OWNED } from './wallet.constants';

// Bakiyeyi değiştirir ve deftere yazar. Dönüş: yeni bakiye; ref daha önce işlendiyse null.
// strict=true: bakiye yetmezse 409; false: bakiye 0'ın altına düşmez.
export async function applyGold(
  manager: EntityManager,
  userId: string,
  delta: number,
  reason: string,
  ref: string | null,
  strict = true,
): Promise<number | null> {
  if (delta === 0) return currentGold(manager, userId);

  const inserted = await manager
    .createQueryBuilder()
    .insert()
    .into(GoldTransaction)
    .values({ userId, delta, reason, ref })
    .orIgnore()
    .execute();
  if (!inserted.identifiers.some(Boolean)) return null;

  const sql = strict
    ? 'UPDATE users SET gold = gold + $2 WHERE id = $1 AND gold + $2 >= 0 RETURNING gold'
    : 'UPDATE users SET gold = GREATEST(gold + $2, 0) WHERE id = $1 RETURNING gold';
  const result = await manager.query(sql, [userId, delta]);
  const rows: Array<{ gold: number }> = Array.isArray(result[0]) ? result[0] : result;
  if (rows.length === 0) throw new ConflictException('Yeterli altının yok');
  return rows[0].gold;
}

export async function currentGold(manager: EntityManager, userId: string): Promise<number> {
  const user = await manager.findOneByOrFail(User, { id: userId });
  return user.gold;
}

@Injectable()
export class WalletService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async state(userId: string) {
    return this.db.transaction((manager) => this.read(manager, userId));
  }

  private async ensureStore(manager: EntityManager, userId: string): Promise<UserStore> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(UserStore)
      .values({ userId, ownedItems: DEFAULT_OWNED, equipped: DEFAULT_EQUIPPED })
      .orIgnore()
      .execute();
    return manager.findOneOrFail(UserStore, { where: { userId }, lock: { mode: 'pessimistic_write' } });
  }

  private async read(manager: EntityManager, userId: string) {
    const store = await this.ensureStore(manager, userId);
    return {
      gold: await currentGold(manager, userId),
      ownedItems: store.ownedItems,
      equipped: store.equipped,
    };
  }

  async purchase(userId: string, itemId: string) {
    return this.db.transaction(async (manager) => {
      const store = await this.ensureStore(manager, userId);
      if (store.ownedItems.includes(itemId)) throw new ConflictException('Bu ürüne zaten sahipsin');
      const item = CATALOG.find((candidate) => candidate.id === itemId)!;
      await applyGold(manager, userId, -item.price, 'purchase', `buy:${itemId}`);
      store.ownedItems = [...store.ownedItems, itemId];
      await manager.save(store);
      return this.read(manager, userId);
    });
  }

  async equip(userId: string, itemId: string) {
    return this.db.transaction(async (manager) => {
      const store = await this.ensureStore(manager, userId);
      if (!store.ownedItems.includes(itemId)) throw new ConflictException('Bu ürüne sahip değilsin');
      const item = CATALOG.find((candidate) => candidate.id === itemId)!;
      store.equipped = { ...store.equipped, [item.type]: item.value };
      await manager.save(store);
      return this.read(manager, userId);
    });
  }
}
