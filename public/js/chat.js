// ── 초기화 ───────────────────────────────────────
const nickname = sessionStorage.getItem('nickname');
const room = sessionStorage.getItem('room');

if (!nickname || !room) {
  location.href = '/';
}

// DOM
const messagesEl = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const messageForm = document.getElementById('messageForm');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const roomTitle = document.getElementById('roomTitle');
const userList = document.getElementById('userList');
const userCount = document.getElementById('userCount');
const sideRoomList = document.getElementById('sideRoomList');
const myNicknameEl = document.getElementById('myNickname');
const leaveBtn = document.getElementById('leaveBtn');

roomTitle.textContent = `# ${room}`;
myNicknameEl.textContent = nickname;

// ── WebSocket 연결 ───────────────────────────────
const WS_URL = `ws://${location.host}`;
let ws;
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;
const RECONNECT_DELAY = 3000;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    reconnectAttempts = 0;
    setStatus('connected');
    enableInput(true);

    // 방 입장
    send({ type: 'join', room, nickname });
  });

  ws.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    handleMessage(data);
  });

  ws.addEventListener('close', (event) => {
    enableInput(false);
    if (event.wasClean) {
      setStatus('disconnected');
    } else {
      scheduleReconnect();
    }
  });

  ws.addEventListener('error', () => {
    setStatus('error');
  });
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT) {
    setStatus('failed');
    appendSystem('재연결 시도 횟수를 초과했습니다. 페이지를 새로고침해주세요.');
    return;
  }
  reconnectAttempts++;
  setStatus('reconnecting', reconnectAttempts);
  appendSystem(`연결이 끊어졌습니다. ${RECONNECT_DELAY / 1000}초 후 재연결 시도합니다... (${reconnectAttempts}/${MAX_RECONNECT})`);
  reconnectTimer = setTimeout(connect, RECONNECT_DELAY);
}

// ── 메시지 처리 ──────────────────────────────────
function handleMessage(data) {
  switch (data.type) {
    case 'message':
      appendMessage(data);
      break;
    case 'system':
      appendSystem(data.text, data.timestamp);
      break;
    case 'users':
      updateUserList(data.list);
      userCount.textContent = data.count;
      break;
    case 'rooms':
      updateRoomList(data.list);
      break;
    case 'error':
      appendSystem(`오류: ${data.text}`, null, 'error');
      break;
    case 'pong':
      break;
    default:
      console.warn('알 수 없는 메시지 타입:', data.type);
  }
}

// ── DOM 렌더링 ───────────────────────────────────
function appendMessage({ nickname: nick, text, timestamp: ts }) {
  const isMine = nick === nickname;
  const wrapper = document.createElement('div');
  wrapper.className = 'message-wrapper ' + (isMine ? 'mine' : 'other');

  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.innerHTML = `<span class="message-nick">${escapeHtml(nick)}</span><span class="message-time">${formatTime(ts)}</span>`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = text;

  if (isMine) {
    wrapper.appendChild(bubble);
    wrapper.appendChild(meta);
  } else {
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = nick[0].toUpperCase();
    avatar.style.background = stringToColor(nick);
    wrapper.appendChild(avatar);
    const body = document.createElement('div');
    body.appendChild(meta);
    body.appendChild(bubble);
    wrapper.appendChild(body);
  }

  messagesEl.appendChild(wrapper);
  scrollToBottom();
}

function appendSystem(text, ts = null, variant = '') {
  const el = document.createElement('div');
  el.className = `system-message ${variant}`;
  el.innerHTML = `<span>${escapeHtml(text)}</span>${ts ? `<span class="system-time">${formatTime(ts)}</span>` : ''}`;
  messagesEl.appendChild(el);
  scrollToBottom();
}

function updateUserList(list) {
  userList.innerHTML = '';
  list.forEach((nick) => {
    const li = document.createElement('li');
    li.className = 'user-item' + (nick === nickname ? ' me' : '');
    const dot = document.createElement('span');
    dot.className = 'online-dot';
    const name = document.createElement('span');
    name.textContent = nick + (nick === nickname ? ' (나)' : '');
    li.appendChild(dot);
    li.appendChild(name);
    userList.appendChild(li);
  });
}

function updateRoomList(list) {
  sideRoomList.innerHTML = '';
  list.forEach(({ name, count }) => {
    const li = document.createElement('li');
    li.className = 'side-room-item' + (name === room ? ' active' : '');
    li.innerHTML = `<span># ${escapeHtml(name)}</span><span class="room-badge">${count}</span>`;
    li.addEventListener('click', () => {
      if (name !== room) {
        sessionStorage.setItem('room', name);
        location.reload();
      }
    });
    sideRoomList.appendChild(li);
  });
}

// ── 입력 처리 ────────────────────────────────────
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = msgInput.value.trim();
  if (!text) return;
  send({ type: 'message', text });
  msgInput.value = '';
  msgInput.focus();
});

leaveBtn.addEventListener('click', () => {
  send({ type: 'leave' });
  ws.close(1000, '사용자 나가기');
  sessionStorage.clear();
  location.href = '/';
});

// ── 유틸 ─────────────────────────────────────────
function send(payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function enableInput(enabled) {
  msgInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
  if (enabled) msgInput.focus();
}

function setStatus(state, attempt = null) {
  statusBadge.className = 'connection-status ' + state;
  const labels = {
    connected: '연결됨',
    disconnected: '연결 끊김',
    reconnecting: `재연결 중... (${attempt}/${MAX_RECONNECT})`,
    failed: '연결 실패',
    error: '오류',
  };
  statusText.textContent = labels[state] ?? state;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

// ── 시작 ─────────────────────────────────────────
connect();
