import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 254, unique: true, nullable: true })
  email: string | null;

  @Column({ name: 'password_hash', type: 'varchar', nullable: true, select: false })
  passwordHash: string | null;

  @Column({ name: 'google_id', type: 'varchar', unique: true, nullable: true })
  googleId: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 30 })
  displayName: string;

  @Column({ name: 'avatar_id', type: 'varchar', length: 20, default: 'fox' })
  avatarId: string;

  @Column({ name: 'is_guest', default: false })
  isGuest: boolean;

  @Column({ type: 'int', default: 0 })
  gold: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
