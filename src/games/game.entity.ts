import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type GameStatus = 'active' | 'won' | 'lost';
export type StoredHints = { revealed: number[]; eliminated: string[] };
export type StoredGuess = { guess: string; plus: number; minus: number };

@Entity('games')
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'smallint' })
  digits: number;

  // Yalnızca sunucuda tutulur; oyun bitmeden istemciye asla döndürülmez.
  @Column({ type: 'varchar', length: 5 })
  secret: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  guesses: StoredGuess[];

  @Column({ type: 'jsonb', default: () => `'{"revealed":[],"eliminated":[]}'` })
  hints: StoredHints;

  @Column({ type: 'varchar', length: 10, default: 'active' })
  status: GameStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
