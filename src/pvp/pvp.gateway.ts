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
      // Aynı hesabın eski bağlantısı kapatılır; tek cihaz oynar.
      const previous = await this.server.in(room(sub)).fetchSockets();
      for (const socket of previous) socket.disconnect(true);
      await client.join(room(sub));
      this.pvp.setConnected(sub, true);
    } catch {
      client.emit('error', { code: 'UNAUTHORIZED', message: 'Oturum geçersiz' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: PvpSocket) {
    const userId = client.data.userId;
    if (!userId) return;
    // Yeni bağlantı eskisinin yerini aldıysa kopma sayılmaz.
    const remaining = await this.server.in(room(userId)).fetchSockets();
    if (remaining.length === 0) this.pvp.setConnected(userId, false);
  }

  @SubscribeMessage('queue')
  async queue(@ConnectedSocket() client: PvpSocket) {
    if (!client.data.userId) return { ok: false };
    await this.pvp.enqueue(client.data.userId);
    return { ok: true };
  }

  @SubscribeMessage('cancel')
  cancel(@ConnectedSocket() client: PvpSocket) {
    if (client.data.userId) this.pvp.dequeue(client.data.userId);
    return { ok: true };
  }

  @SubscribeMessage('guess')
  guess(@ConnectedSocket() client: PvpSocket, @MessageBody() body: { guess?: unknown }) {
    if (!client.data.userId) return { ok: false, code: 'UNAUTHORIZED' };
    try {
      if (typeof body?.guess !== 'string') throw Object.assign(new Error('Geçersiz tahmin'), { code: 'INVALID_GUESS' });
      return { ok: true, ...this.pvp.guess(client.data.userId, body.guess) };
    } catch (error) {
      const { code, message } = error as { code?: string; message: string };
      return { ok: false, code: code ?? 'ERROR', message };
    }
  }
}
