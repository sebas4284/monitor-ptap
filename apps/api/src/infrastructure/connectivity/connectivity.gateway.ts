import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { Subscription } from 'rxjs';
import { ConnectivityService } from './connectivity.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ConnectivityGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  private server!: Server;

  private subscription?: Subscription;

  constructor(private readonly connectivity: ConnectivityService) {}

  onModuleInit(): void {
    this.subscription = this.connectivity.snapshot$.subscribe(snapshot => {
      this.server.to(snapshot.plantId).emit('opc:snapshot', snapshot);
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  @SubscribeMessage('opc:subscribe')
  async subscribeToPlant(
    @MessageBody() payload: { plantId?: string },
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    const plantId = payload.plantId;
    if (!plantId) {
      return;
    }

    for (const room of client.rooms) {
      if (room.startsWith('ptap-')) {
        await client.leave(room);
      }
    }

    await client.join(plantId);
    const snapshot = await this.connectivity.getSnapshot(plantId);
    client.emit('opc:snapshot', snapshot);
  }
}
