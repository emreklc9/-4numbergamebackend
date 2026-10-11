import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

export type PvpEndReason = 'solved' | 'idle' | 'disconnect';

// Kullanıcı silinse de maç geçmişi kalır; bu yüzden oyuncular FK ile bağlanmaz.
@Entity('pvp_matches')
export class PvpMatch {
  @PrimaryColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'player1_id', type: 'uuid' })
  player1Id: string;

  @Index()
  @Column({ name: 'player2_id', type: 'uuid' })
  player2Id: string;

  @Column({ name: 'winner_id', type: 'uuid' })
  winnerId: string;

  @Column({ type: 'smallint' })
  digits: number;

  // Ortak sayıda 4 hane. Rakip modunda iki sayı `1234:5678` biçiminde durur.
  @Column({ type: 'varchar', length: 9 })
  secret: string;

  @Column({ type: 'varchar', length: 12 })
  reason: PvpEndReason;

  @Column({ name: 'player1_attempts', type: 'smallint' })
  player1Attempts: number;

  @Column({ name: 'player2_attempts', type: 'smallint' })
  player2Attempts: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
