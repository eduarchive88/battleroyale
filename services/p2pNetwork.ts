
import { GameState } from '../types';

// 전역 window 객체에 PeerJS가 로드되었음을 알림
declare global {
  interface Window {
    Peer: any;
  }
}

type MessageType = 'STATE_UPDATE' | 'PLAYER_ACTION';

interface P2PMessage {
  type: MessageType;
  payload: any;
}

class P2PNetwork {
  private peer: any = null;
  private connections: Record<string, any> = {};
  private isHost: boolean = false;
  private onStateChange: ((state: GameState) => void) | null = null;
  private gameState: GameState | null = null;
  private triggerAction: any = null;

  private sanitizeId(code: string): string {
    // 공백 및 특수문자 제거하여 PeerJS ID 규격 맞춤
    return `edu-arena-${code.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }

  init(roomCode: string, isHost: boolean, onStateChange: (state: GameState) => void, onReady?: () => void) {
    this.isHost = isHost;
    this.onStateChange = onStateChange;
    const peerId = this.sanitizeId(roomCode);

    // 기존 피어 인스턴스가 있다면 완전히 파괴
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch (e) {
        console.error("Peer destroy failed", e);
      }
      this.peer = null;
      this.connections = {};
    }

    // window.Peer 라이브러리 존재 확인
    if (typeof window.Peer === 'undefined') {
      alert("통신 라이브러리가 로드되지 않았습니다. 페이지를 새로고침해주세요.");
      return;
    }

    // 호스트는 지정된 ID를 사용, 게스트는 서버가 주는 자동 ID 사용
    this.peer = new window.Peer(isHost ? peerId : undefined, {
      debug: 2, // 디버깅을 위해 로그 레벨 상향
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    this.peer.on('open', (id: string) => {
      console.log(`[P2P] Peer Opened. My ID: ${id}`);
      if (onReady) onReady();
      
      if (!isHost) {
        // 게스트인 경우 호스트에게 즉시 연결 시도
        setTimeout(() => this.connectToHost(peerId), 300);
      }
    });

    this.peer.on('error', (err: any) => {
      console.error('[P2P] Fatal Error:', err.type, err);
      if (err.type === 'unavailable-id') {
        alert("교사 전용: 해당 방 코드가 이미 서버에 등록되어 있습니다. 1~2분 뒤에 다시 시도하거나 다른 코드를 써주세요.");
      } else if (err.type === 'peer-not-found') {
        alert("방을 찾을 수 없습니다. 교사 화면이 먼저 켜져 있는지 확인하세요.");
      } else if (err.type === 'network') {
        console.warn("네트워크 일시적 오류, 재연결을 시도하지 않습니다.");
      }
      // 에러 발생 시 로딩 상태 해제를 위해 강제 초기화
      window.location.hash = ''; 
    });

    if (isHost) {
      this.peer.on('connection', (conn: any) => {
        this.setupConnection(conn);
      });
    }
  }

  private connectToHost(hostId: string) {
    if (!this.peer || this.peer.destroyed) return;
    console.log(`[P2P] Connecting to Host: ${hostId}`);
    const conn = this.peer.connect(hostId, {
      reliable: true,
      serialization: 'json'
    });
    this.setupConnection(conn);
  }

  private setupConnection(conn: any) {
    conn.on('open', () => {
      console.log(`[P2P] Connected with: ${conn.peer}`);
      this.connections[conn.peer] = conn;
      
      if (this.isHost && this.gameState) {
        // 새 학생 접속 시 현재 상태 즉시 전송
        this.broadcastState(this.gameState);
      }
    });

    conn.on('data', (data: P2PMessage) => {
      this.handleMessage(data, conn);
    });

    conn.on('close', () => {
      console.log(`[P2P] Disconnected: ${conn.peer}`);
      delete this.connections[conn.peer];
    });

    conn.on('error', (err: any) => {
      console.error(`[P2P] Conn Error:`, err);
      delete this.connections[conn.peer];
    });
  }

  private handleMessage(msg: P2PMessage, conn: any) {
    if (this.isHost) {
      if (msg.type === 'PLAYER_ACTION' && this.triggerAction) {
        this.triggerAction(msg.payload);
      }
    } else {
      if (msg.type === 'STATE_UPDATE') {
        this.gameState = msg.payload;
        if (this.onStateChange) this.onStateChange(this.gameState!);
      }
    }
  }

  broadcastState(state: GameState) {
    this.gameState = state;
    const msg: P2PMessage = { type: 'STATE_UPDATE', payload: state };
    Object.values(this.connections).forEach((conn: any) => {
      if (conn.open) {
        try {
          conn.send(msg);
        } catch (e) {
          console.error("Broadcast failed for peer", conn.peer, e);
        }
      }
    });
  }

  sendAction(action: any) {
    const msg: P2PMessage = { type: 'PLAYER_ACTION', payload: action };
    Object.values(this.connections).forEach((conn: any) => {
      if (conn.open) {
        try {
          conn.send(msg);
        } catch (e) {
          console.error("Action send failed", e);
        }
      }
    });
  }

  setActionListener(fn: any) { 
    this.triggerAction = fn; 
  }
}

export const network = new P2PNetwork();
