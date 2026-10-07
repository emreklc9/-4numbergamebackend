import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Altın işlem defteri. (userId, ref) tekil olduğundan aynı işlem iki kez uygulanamaz.
@Entity('gold_transactions')
@Index(['userId', 'ref'], { unique: true })
export class GoldTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'int' })
  delta: number;

  @Column({ type: 'varchar', length: 30 })
  reason: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  ref: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
