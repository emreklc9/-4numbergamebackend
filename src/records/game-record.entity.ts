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

@Entity('game_records')
@Index(['digits', 'attempts'])
@Index(['userId', 'clientId'], { unique: true })
export class GameRecord {
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

  @Column({ type: 'smallint' })
  attempts: number;

  // false: çevrimdışı oynanmış, sunucunun doğrulayamadığı rekor. Liderlik tablosunda sayılmaz.
  @Column({ default: true })
  verified: boolean;

  // Toplu yüklemede tekrar gönderimi (çift kayıt) engelleyen istemci kimliği.
  @Column({ name: 'client_id', type: 'varchar', length: 64, nullable: true })
  clientId: string | null;

  @Column({ name: 'played_at', type: 'timestamptz', nullable: true })
  playedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
