import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { PvpService } from './pvp.service';

type PvpSocket = Socket & { data: { userId?: string } };

const room = (userId: string) => `user:${userId}`;

@WebSocketGateway({ namespace: 'pvp', cors: true })
export class PvpGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PvpGateway.name);
  @WebSocketServer() private server!: Server;
  // Kullanıcının güncel soketi. Eski bağlantının gecikmiş iptali yeni aramayı kuyruktan düşürmesin.
  private readonly liveSocket = new Map<string, string>();

  constructor(
    private readonly pvp: PvpService,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  afterInit() {
    this.pvp.setEmitter((userId, event, payload) => this.server.to(room(userId)).emit(event, payload));
  }

  async handleConnection(client: PvpSocket) {
    try {
      const token = client.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('token yok');
      const { sub } = await this.jwt.verifyAsync<{ sub: string }>(token);
      if (!(await this.users.findById(sub))) throw new Error('kullanıcı yok');
      client.data.userId = sub;
      this.liveSocket.set(sub, client.id);
      // Aynı hesabın eski bağlantısı kapatılır; tek cihaz oynar.
      const previous = await this.server.in(room(sub)).fetchSockets();
      for (const socket of previous) {
        if (socket.id !== client.id) socket.disconnect(true);
      }
      await client.join(room(sub));
      this.pvp.setConnected(sub, true);
    } catch {
      client.emit('error', { code: 'UNAUTHORIZED', message: 'Oturum geçersiz' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: PvpSocket) {
    const userId = client.data.userId;
    if (!userId || !this.isLive(client)) return;
    this.liveSocket.delete(userId);
    this.pvp.setConnected(userId, false);
  }

  @SubscribeMessage('queue')
  async queue(@ConnectedSocket() client: PvpSocket, @MessageBody() body: { mode?: unknown }) {
    if (!this.isLive(client)) return { ok: false };
    const mode = body?.mode === 'duel' ? 'duel' : 'shared';
    await this.pvp.enqueue(client.data.userId!, mode);
    return { ok: true };
  }

  @SubscribeMessage('secret')
  secret(@ConnectedSocket() client: PvpSocket, @MessageBody() body: { secret?: unknown }) {
    const userId = client.data.userId;
    if (!userId || !this.isLive(client)) return { ok: false, code: 'UNAUTHORIZED' };
    try {
      if (typeof body?.secret !== 'string') {
        throw Object.assign(new Error('Geçersiz sayı'), { code: 'INVALID_GUESS' });
      }
      this.pvp.submitSecret(userId, body.secret);
      return { ok: true };
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return { ok: false, code: code ?? 'ERROR', message };
    }
  }

  @SubscribeMessage('cancel')
  cancel(@ConnectedSocket() client: PvpSocket) {
    if (!this.isLive(client)) return { ok: false };
    this.pvp.dequeue(client.data.userId!);
    return { ok: true };
  }

  @SubscribeMessage('hint')
  async hint(@ConnectedSocket() client: PvpSocket, @MessageBody() body: { type?: unknown }) {
    if (!this.isLive(client)) return { ok: false, code: 'UNAUTHORIZED' };
    try {
      if (body?.type !== 'reveal' && body?.type !== 'eliminate') {
        throw Object.assign(new Error('Geçersiz ipucu'), { code: 'INVALID_HINT' });
      }
      return { ok: true, ...(await this.pvp.hint(client.data.userId!, body.type)) };
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return { ok: false, code: code ?? 'ERROR', message };
    }
  }

  private isLive(client: PvpSocket) {
    return !!client.data.userId && this.liveSocket.get(client.data.userId) === client.id;
  }

  @SubscribeMessage('guess')
  guess(@ConnectedSocket() client: PvpSocket, @MessageBody() body: { guess?: unknown }) {
    const userId = client.data.userId;
    if (!userId || !this.isLive(client)) return { ok: false, code: 'UNAUTHORIZED' };
    try {
      if (typeof body?.guess !== 'string') throw Object.assign(new Error('Geçersiz tahmin'), { code: 'INVALID_GUESS' });
      return { ok: true, ...this.pvp.guess(userId, body.guess) };
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return { ok: false, code: code ?? 'ERROR', message };
    }
  }
}
