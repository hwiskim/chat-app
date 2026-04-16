# 실시간 채팅 애플리케이션

WebSocket(ws 라이브러리)과 Node.js로 구현한 실시간 다중 채팅방 애플리케이션입니다.  
외부 프레임워크(Socket.io 등) 없이 순수 WebSocket API를 직접 다루는 것에 초점을 맞췄습니다.

---

## 기술 스택

| 구분 | 사용 기술 |
|------|-----------|
| 런타임 | Node.js |
| 서버 프레임워크 | Express 4 |
| WebSocket | ws 8 |
| 프론트엔드 | Vanilla JS / HTML / CSS (빌드 도구 없음) |

---

## 주요 기능

- **다중 채팅방** — 사이드바에서 방을 클릭해 자유롭게 이동
- **실시간 메시지** — WebSocket 연결로 지연 없이 전체 브로드캐스트
- **참여자 목록** — 방 입장/퇴장 시 실시간 갱신
- **입장 / 퇴장 알림** — 시스템 메시지로 모든 참여자에게 표시
- **자동 재연결** — 연결이 끊기면 최대 5회, 3초 간격으로 재시도
- **Heartbeat** — 서버가 30초마다 ping을 보내 유령 연결(zombie connection) 탐지 및 자동 제거
- **XSS 방어** — 모든 사용자 입력을 `escapeHtml`로 이스케이프 처리

---

## 프로젝트 구조

```
chat-app/
├── server/
│   ├── index.js        # Express + WebSocketServer, 메시지 라우팅
│   └── ChatRoom.js     # ChatRoom / RoomManager 클래스
└── public/
    ├── index.html      # 닉네임 입력 + 방 선택 페이지
    ├── chat.html       # 채팅 UI
    ├── css/
    │   └── style.css   # 다크 테마 스타일
    └── js/
        └── chat.js     # 클라이언트 WebSocket 로직
```

---

## 실행 방법

```bash
# 1. 의존성 설치
npm install

# 2. 서버 시작
npm start
# → http://localhost:3000

# 개발 모드 (nodemon, 파일 변경 시 자동 재시작)
npm run dev
```

포트를 바꾸려면 환경 변수로 지정합니다.

```bash
PORT=8080 npm start
```

---

## WebSocket 메시지 프로토콜

서버-클라이언트 간 모든 메시지는 JSON 문자열로 주고받습니다.

### Client → Server

| type | 필드 | 설명 |
|------|------|------|
| `join` | `room`, `nickname` | 방 입장. 이미 다른 방에 있으면 자동으로 퇴장 후 입장 |
| `message` | `text` | 현재 방 전체에 메시지 브로드캐스트 (최대 500자) |
| `leave` | — | 현재 방에서 나가기 |
| `ping` | — | 애플리케이션 레벨 ping (서버가 `pong`으로 응답) |

```json
// 입장 예시
{ "type": "join", "room": "일반", "nickname": "홍길동" }

// 메시지 전송 예시
{ "type": "message", "text": "안녕하세요!" }
```

### Server → Client

| type | 주요 필드 | 설명 |
|------|-----------|------|
| `message` | `nickname`, `text`, `timestamp` | 채팅 메시지 |
| `system` | `text`, `timestamp` | 입장/퇴장 등 시스템 알림 |
| `users` | `count`, `list[]` | 현재 방 참여자 목록 갱신 |
| `rooms` | `list[{ name, count }]` | 전체 방 목록 갱신 |
| `error` | `text` | 오류 메시지 |
| `pong` | `timestamp` | ping에 대한 응답 |

```json
// 채팅 메시지 예시
{ "type": "message", "nickname": "홍길동", "text": "안녕하세요!", "timestamp": "2026-04-16T10:00:00.000Z" }

// 참여자 목록 예시
{ "type": "users", "count": 3, "list": ["홍길동", "이순신", "강감찬"] }
```

---

## 핵심 구현 설명

### Heartbeat (유령 연결 탐지)

브라우저가 비정상 종료되면 `close` 이벤트가 발생하지 않아 서버에 죽은 연결이 남습니다.  
이를 방지하기 위해 서버가 30초마다 WebSocket 프로토콜 레벨의 `ping` 프레임을 전송합니다.  
클라이언트가 `pong`으로 응답하면 살아있는 것으로 간주하고, 응답이 없으면 `ws.terminate()`로 강제 종료합니다.

```js
// server/index.js
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate(); // 응답 없음 → 강제 종료
    ws.isAlive = false;
    ws.ping();                              // ping 전송
  });
}, 30_000);

ws.on('pong', () => { ws.isAlive = true; }); // 응답 수신 → 살아있음 표시
```

### 자동 재연결

클라이언트는 비정상 종료(`event.wasClean === false`)를 감지하면 고정 3초 간격으로 최대 5회 재연결을 시도합니다.  
재연결 성공 시 자동으로 `join` 메시지를 다시 보내 방에 재입장합니다.

```js
// public/js/chat.js
ws.addEventListener('close', (event) => {
  if (!event.wasClean) scheduleReconnect(); // 비정상 종료일 때만 재연결
});

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT) { setStatus('failed'); return; }
  reconnectAttempts++;
  reconnectTimer = setTimeout(connect, 3000);
}
```

### ChatRoom / RoomManager 클래스

`ChatRoom`은 내부적으로 `Map<WebSocket, { nickname, joinedAt }>`을 유지합니다.  
WebSocket 객체를 키로 사용하기 때문에 별도의 ID 관리 없이 O(1)로 유저를 추가/제거/조회할 수 있습니다.

```js
// server/ChatRoom.js
class ChatRoom {
  constructor(name) {
    this.clients = new Map(); // ws → { nickname, joinedAt }
  }

  broadcast(payload, excludeWs = null) {
    const message = JSON.stringify(payload);
    for (const [ws] of this.clients) {
      if (ws !== excludeWs && ws.readyState === ws.OPEN) ws.send(message);
    }
  }
}
```

`RoomManager`는 방 이름을 키로 `ChatRoom` 인스턴스를 관리하며, 서버 시작 시 기본 방 3개(일반, 자유, 개발)를 미리 생성합니다.

### 방 이동 처리

`join` 메시지를 받을 때 `ws.currentRoom`이 이미 설정되어 있으면 이전 방에서 자동으로 퇴장 처리합니다.  
클라이언트는 `leave` 없이 `join`만 보내도 방 이동이 됩니다.

```js
// server/index.js — join 핸들러 일부
if (ws.currentRoom) {
  const prevRoom = roomManager.get(ws.currentRoom);
  prevRoom.remove(ws);
  prevRoom.broadcast({ type: 'system', text: `${ws.nickname}님이 나갔습니다.` });
}
```

---

## 화면 구성

```
┌─────────────────────────────────────────────────────┐
│ 사이드바                  메인 채팅 영역              │
│                                                     │
│ 💬 실시간 채팅            # 일반        ● 연결됨     │
│ ─────────────           ─────────────────────────  │
│ 채팅방                                              │
│ # 일반  ●  3             홍길동님이 입장했습니다.    │
│ # 자유     1                                        │
│ # 개발     0                    안녕하세요!          │
│ ─────────────            이순신  오후 10:01         │
│ 참여자 3명               ┌──────────────┐           │
│ ● 홍길동 (나)            │ 안녕하세요!  │           │
│ ● 이순신                 └──────────────┘           │
│ ● 강감찬                                            │
│ ─────────────           ─────────────────────────  │
│ 홍길동  [나가기]         [입력창..........]  [전송]  │
└─────────────────────────────────────────────────────┘
```

---

## 의존성

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "nodemon": "^3.1.0"
  }
}
```

- **express** — 정적 파일 서빙 및 HTTP 서버 생성
- **ws** — Node.js용 WebSocket 서버/클라이언트 구현체
- **nodemon** — 개발 중 파일 변경 감지 및 자동 재시작
