
import { GameState, Player, Role, ClassType } from '../types';

declare const Peer: any;

type MessageType = 'STATE_UPDATE' | 'PLAYER_ACTION' | 'HEARTBEAT' | 'HEARTBEAT_ACK' | 'PLAYER_JOIN';

interface P2PMessage {
  type: MessageType;
  payload: any;
  senderId?: string;
}

class P2PNetwork {
  private peer: any = null;
  private connections: Record<string, any> = {};
  private isHost: boolean = false;
  private onStateChange: ((state: GameState) => void) | null = null;
  private gameState: GameState | null = null;

  init(roomCode: string, isHost: boolean, onStateChange: (state: GameState) => void) {
    this.isHost = isHost;
    this.onStateChange = onStateChange;
    const peerId = `edu-arena-${roomCode}`;

    this.peer = new Peer(isHost ? peerId : undefined);

    this.peer.on('open', (id: string) => {
      console.log('Peer connected with ID:', id);
      if (!isHost) {
        this.connectToHost(peerId);
      }
    });

    if (isHost) {
      this.peer.on('connection', (conn: any) => {
        this.setupConnection(conn);
      });
    }
  }

  private connectToHost(hostId: string) {
    const conn = this.peer.connect(hostId);
    this.setupConnection(conn);
  }

  private setupConnection(conn: any) {
    conn.on('open', () => {
      this.connections[conn.peer] = conn;
      console.log('Connection established with:', conn.peer);
    });

    conn.on('data', (data: P2PMessage) => {
      this.handleMessage(data, conn);
    });

    conn.on('close', () => {
      delete this.connections[conn.peer];
    });
  }

  private handleMessage(msg: P2PMessage, conn: any) {
    if (this.isHost) {
      if (msg.type === 'PLAYER_JOIN') {
        // 교사는 새 플레이어 정보를 받고 상태 업데이트 후 전파
        if (this.onStateChange && this.gameState) {
            // 호스트 로직에서 처리하도록 이벤트만 발생시키거나 직접 처리
        }
      }
      if (msg.type === 'PLAYER_ACTION') {
          // 호스트는 플레이어의 액션을 받아 GameState 반영 (Authority)
          this.triggerAction(msg.payload);
      }
    } else {
      if (msg.type === 'STATE_UPDATE') {
        this.gameState = msg.payload;
        if (this.onStateChange) this.onStateChange(this.gameState!);
      }
    }
  }

  // 호스트가 전체 학생에게 상태 전송
  broadcastState(state: GameState) {
    this.gameState = state;
    const msg: P2PMessage = { type: 'STATE_UPDATE', payload: state };
    Object.values(this.connections).forEach((conn: any) => {
      if (conn.open) conn.send(msg);
    });
  }

  // 학생이 호스트에게 액션 전송
  sendAction(action: any) {
    const msg: P2PMessage = { type: 'PLAYER_ACTION', payload: action };
    Object.values(this.connections).forEach((conn: any) => {
      if (conn.open) conn.send(msg);
    });
  }

  private triggerAction: any = null;
  setActionListener(fn: any) { this.triggerAction = fn; }
}

export const network = new P2PNetwork();
