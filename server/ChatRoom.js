class ChatRoom {
  constructor(name) {
    this.name = name;
    // Map<ws, { nickname, joinedAt }>
    this.clients = new Map();
  }

  add(ws, nickname) {
    this.clients.set(ws, { nickname, joinedAt: Date.now() });
  }

  remove(ws) {
    this.clients.delete(ws);
  }

  has(ws) {
    return this.clients.has(ws);
  }

  getNickname(ws) {
    return this.clients.get(ws)?.nickname ?? '알 수 없음';
  }

  getUserList() {
    return [...this.clients.values()].map((c) => c.nickname);
  }

  get size() {
    return this.clients.size;
  }

  broadcast(payload, excludeWs = null) {
    const message = JSON.stringify(payload);
    for (const [ws] of this.clients) {
      if (ws === excludeWs) continue;
      if (ws.readyState === ws.OPEN) {
        ws.send(message);
      }
    }
  }

  send(ws, payload) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    // 기본 방 3개 생성
    ['일반', '자유', '개발'].forEach((name) => this.getOrCreate(name));
  }

  getOrCreate(name) {
    if (!this.rooms.has(name)) {
      this.rooms.set(name, new ChatRoom(name));
    }
    return this.rooms.get(name);
  }

  get(name) {
    return this.rooms.get(name) ?? null;
  }

  getRoomList() {
    return [...this.rooms.entries()].map(([name, room]) => ({
      name,
      count: room.size,
    }));
  }

  findRoomByWs(ws) {
    for (const room of this.rooms.values()) {
      if (room.has(ws)) return room;
    }
    return null;
  }
}

module.exports = { ChatRoom, RoomManager };
