import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('user_stores')
export class UserStore {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'owned_items', type: 'jsonb' })
  ownedItems: string[];

  @Column({ type: 'jsonb' })
  equipped: Record<string, string>;
}
