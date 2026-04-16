const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./ChatRoom');

const PORT = process.env.PORT || 3000;
const HEARTBEAT_INTERVAL = 30_000; // 30초

const app = express();
app.use(express.static(path.join(__dirname, '../public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const roomManager = new RoomManager();

// ── 메시지 타입 상수 ──────────────────────────────
const TYPE = {
  JOIN: 'join',
  LEAVE: 'leave',
  MESSAGE: 'message',
  SYSTEM: 'system',
  USERS: 'users',
  ROOMS: 'rooms',
  ERROR: 'error',
  PING: 'ping',
  PONG: 'pong',
};

function timestamp() {
  return new Date().toISOString();
}

function broadcastRoomList() {
  const payload = { type: TYPE.ROOMS, list: roomManager.getRoomList(), timestamp: timestamp() };
  const message = JSON.stringify(payload);
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(message);
  }
}

function broadcastUserList(room) {
  room.broadcast({
    type: TYPE.USERS,
    count: room.size,
    list: room.getUserList(),
    timestamp: timestamp(),
  });
}

// ── WebSocket 연결 처리 ───────────────────────────
wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.nickname = null;
  ws.currentRoom = null;

  console.log(`[연결] ${req.socket.remoteAddress}`);

  // 처음 연결 시 방 목록 전달
  ws.send(JSON.stringify({ type: TYPE.ROOMS, list: roomManager.getRoomList(), timestamp: timestamp() }));

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      ws.send(JSON.stringify({ type: TYPE.ERROR, text: '잘못된 메시지 형식입니다.' }));
      return;
    }

    switch (payload.type) {
      case TYPE.JOIN: {
        const { room: roomName, nickname } = payload;

        if (!nickname || nickname.trim().length === 0) {
          ws.send(JSON.stringify({ type: TYPE.ERROR, text: '닉네임을 입력해주세요.' }));
          return;
        }
        if (!roomName) {
          ws.send(JSON.stringify({ type: TYPE.ERROR, text: '방 이름이 필요합니다.' }));
          return;
        }

        // 이전 방에서 나가기
        if (ws.currentRoom) {
          const prevRoom = roomManager.get(ws.currentRoom);
          if (prevRoom) {
            prevRoom.remove(ws);
            prevRoom.broadcast({
              type: TYPE.SYSTEM,
              text: `${ws.nickname}님이 [${ws.currentRoom}] 방을 나갔습니다.`,
              timestamp: timestamp(),
            });
            broadcastUserList(prevRoom);
          }
        }

        const trimmedNick = nickname.trim().slice(0, 20);
        ws.nickname = trimmedNick;
        ws.currentRoom = roomName;

        const room = roomManager.getOrCreate(roomName);
        room.add(ws, trimmedNick);

        // 입장한 본인에게 확인 메시지
        room.send(ws, {
          type: TYPE.SYSTEM,
          text: `[${roomName}] 방에 입장했습니다. 반갑습니다, ${trimmedNick}님!`,
          timestamp: timestamp(),
        });

        // 다른 유저들에게 입장 알림
        room.broadcast(
          { type: TYPE.SYSTEM, text: `${trimmedNick}님이 입장했습니다.`, timestamp: timestamp() },
          ws,
        );

        // 유저 목록 갱신
        broadcastUserList(room);
        broadcastRoomList();

        console.log(`[입장] ${trimmedNick} → [${roomName}]`);
        break;
      }

      case TYPE.MESSAGE: {
        const text = payload.text?.trim();
        if (!text || text.length === 0) return;
        if (!ws.currentRoom || !ws.nickname) {
          ws.send(JSON.stringify({ type: TYPE.ERROR, text: '먼저 방에 입장해주세요.' }));
          return;
        }

        const room = roomManager.get(ws.currentRoom);
        if (!room) return;

        const outgoing = {
          type: TYPE.MESSAGE,
          nickname: ws.nickname,
          text: text.slice(0, 500),
          timestamp: timestamp(),
        };

        // 본인 포함 전체 브로드캐스트
        room.broadcast(outgoing);
        console.log(`[메시지] [${ws.currentRoom}] ${ws.nickname}: ${text.slice(0, 60)}`);
        break;
      }

      case TYPE.LEAVE: {
        handleLeave(ws);
        break;
      }

      case TYPE.PING: {
        ws.send(JSON.stringify({ type: TYPE.PONG, timestamp: timestamp() }));
        break;
      }

      default:
        ws.send(JSON.stringify({ type: TYPE.ERROR, text: `알 수 없는 메시지 타입: ${payload.type}` }));
    }
  });

  ws.on('close', () => {
    handleLeave(ws);
    console.log(`[연결 해제] ${ws.nickname ?? '미입장'}`);
  });

  ws.on('error', (err) => {
    console.error(`[에러] ${ws.nickname ?? '미입장'}:`, err.message);
  });
});

function handleLeave(ws) {
  if (!ws.currentRoom) return;
  const room = roomManager.get(ws.currentRoom);
  if (room) {
    room.remove(ws);
    if (ws.nickname) {
      room.broadcast({
        type: TYPE.SYSTEM,
        text: `${ws.nickname}님이 나갔습니다.`,
        timestamp: timestamp(),
      });
      broadcastUserList(room);
    }
    broadcastRoomList();
  }
  ws.currentRoom = null;
}

// ── Heartbeat (연결 유지 감지) ────────────────────
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log(`[Heartbeat] 응답 없음 → 연결 종료: ${ws.nickname ?? '미입장'}`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(heartbeatTimer));

// ── 서버 시작 ─────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✅ 채팅 서버 실행 중: http://localhost:${PORT}`);
});
