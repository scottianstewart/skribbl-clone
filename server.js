'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Database = require('better-sqlite3');

// ─── Database ─────────────────────────────────────────────────────────────────
const dbPath = process.env.DB_PATH || path.join(__dirname, 'gallery.db');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS gallery_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    word       TEXT    NOT NULL,
    drawer     TEXT    NOT NULL,
    room_code  TEXT    NOT NULL,
    round      INTEGER NOT NULL,
    played_at  TEXT    DEFAULT (datetime('now')),
    image_data TEXT    NOT NULL
  )
`);
const insertItem = db.prepare(
  'INSERT INTO gallery_items (word, drawer, room_code, round, image_data) VALUES (?, ?, ?, ?, ?)'
);
const selectItems = db.prepare(
  'SELECT id, word, drawer, room_code, round, played_at FROM gallery_items ORDER BY id DESC LIMIT ? OFFSET ?'
);
const selectItemsByDrawer = db.prepare(
  'SELECT id, word, drawer, room_code, round, played_at FROM gallery_items WHERE drawer = ? ORDER BY id DESC LIMIT ? OFFSET ?'
);
const countItems = db.prepare('SELECT COUNT(*) as total FROM gallery_items');
const countItemsByDrawer = db.prepare('SELECT COUNT(*) as total FROM gallery_items WHERE drawer = ?');
const selectDrawers = db.prepare('SELECT DISTINCT drawer FROM gallery_items ORDER BY drawer COLLATE NOCASE ASC');
const selectItemById = db.prepare(
  'SELECT id, word, drawer, room_code, round, played_at, image_data FROM gallery_items WHERE id = ?'
);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Word List ────────────────────────────────────────────────────────────────
const WORDS = [
  // Animals
  'cat', 'dog', 'horse', 'elephant', 'penguin', 'shark', 'dolphin', 'eagle',
  'tiger', 'rabbit', 'frog', 'butterfly', 'whale', 'crocodile', 'giraffe',
  'owl', 'parrot', 'turtle', 'bear', 'fox', 'wolf', 'deer', 'monkey', 'fish',
  'lobster', 'scorpion', 'snail', 'peacock', 'flamingo', 'kangaroo',
  // Food
  'pizza', 'apple', 'banana', 'cake', 'hamburger', 'sushi', 'strawberry',
  'watermelon', 'corn', 'carrot', 'mushroom', 'cheese', 'donut', 'taco',
  'sandwich', 'cookie', 'lemon', 'cherry', 'grapes', 'pineapple', 'broccoli',
  'popcorn', 'muffin', 'pretzel', 'noodles', 'toast', 'avocado', 'waffle',
  'hotdog', 'cupcake',
  // Objects
  'chair', 'table', 'lamp', 'telephone', 'umbrella', 'key', 'clock',
  'bicycle', 'anchor', 'camera', 'compass', 'hammer', 'scissors', 'trophy',
  'suitcase', 'guitar', 'crown', 'bell', 'book', 'candle', 'envelope',
  'glasses', 'hat', 'magnet', 'mirror', 'ring', 'rope', 'shield', 'sword',
  'backpack',
  // Places / Nature
  'mountain', 'island', 'volcano', 'beach', 'forest', 'castle', 'rainbow',
  'river', 'cave', 'desert', 'lighthouse', 'bridge', 'waterfall', 'cloud',
  'moon', 'sun', 'star', 'snowflake', 'tornado', 'tree', 'flower', 'cactus',
  'wave', 'iceberg', 'cliff', 'lake', 'valley', 'canyon', 'glacier', 'pond',
  // Transport
  'rocket', 'boat', 'train', 'airplane', 'helicopter', 'submarine', 'balloon',
  'skateboard', 'motorcycle', 'truck', 'canoe', 'spaceship', 'tractor',
  'parachute', 'tank', 'bulldozer', 'sailboat', 'ambulance', 'bus', 'scooter',
  // People / Costumes
  'pirate', 'wizard', 'robot', 'knight', 'astronaut', 'ninja', 'chef',
  'doctor', 'clown', 'superhero', 'cowboy', 'viking', 'mummy', 'ghost',
  'vampire', 'witch', 'ballerina', 'firefighter', 'detective', 'king',
  // Actions / Misc
  'swimming', 'jumping', 'climbing', 'dancing', 'sleeping', 'cooking',
  'flying', 'running', 'reading', 'painting', 'throwing', 'fishing', 'digging',
  'skating', 'surfing', 'building', 'planting', 'pushing', 'laughing', 'crying',
  // More objects
  'television', 'computer', 'phone', 'speaker', 'headphones', 'lantern',
  'barrel', 'bucket', 'ladder', 'telescope', 'microscope', 'hourglass',
  'chess', 'dice', 'balloon', 'kite', 'drum', 'trumpet', 'violin', 'piano',
];

// ─── Utility ──────────────────────────────────────────────────────────────────
function randomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWords(count) {
  return shuffle(WORDS).slice(0, count);
}

function makeHint(word) {
  return word.split('').map(c => (c === ' ' ? '  ' : '_')).join(' ');
}

function getTimeRemaining(room) {
  if (!room.turnStartTime) return 0;
  const elapsed = Math.floor((Date.now() - room.turnStartTime) / 1000);
  return Math.max(0, room.config.timeLimit - elapsed);
}

function getConnectedPlayers(room) {
  return [...room.players.values()].filter(p => p.connected);
}

function getPlayersArray(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    score: p.score,
    hasGuessed: p.hasGuessed,
    avatarIndex: p.avatarIndex,
  }));
}

function getOpenRooms() {
  const result = [];
  for (const room of rooms.values()) {
    if (room.phase !== 'waiting') continue;
    const connected = getConnectedPlayers(room);
    if (connected.length === 0) continue;
    const host = room.players.get(room.hostId);
    result.push({
      code: room.code,
      hostName: host ? host.name : '?',
      playerCount: connected.length,
      config: room.config,
    });
  }
  return result;
}

function broadcastOpenRooms() {
  io.emit('open-rooms', getOpenRooms());
}

// ─── Room State ───────────────────────────────────────────────────────────────
const rooms = new Map(); // code → room
const socketRoom = new Map(); // socketId → roomCode

function createRoom(hostSocket, username) {
  let code;
  do { code = randomCode(); } while (rooms.has(code));

  const room = {
    code,
    hostId: hostSocket.id,
    players: new Map(),
    phase: 'waiting',
    config: { rounds: 3, timeLimit: 80 },
    currentRound: 0,
    drawerOrder: [],
    drawerIndex: 0,
    currentWord: null,
    wordChoices: [],
    strokeHistory: [],
    screenshots: [],
    timer: null,
    choiceTimer: null,
    turnStartTime: 0,
    guessedCount: 0,
    screenshotReceived: false,
    avatarCounter: 0,
  };

  addPlayerToRoom(room, hostSocket, username);
  rooms.set(code, room);
  return room;
}

function addPlayerToRoom(room, socket, username) {
  room.players.set(socket.id, {
    id: socket.id,
    name: username,
    score: 0,
    hasGuessed: false,
    connected: true,
    avatarIndex: room.avatarCounter++,
  });
  socket.join(room.code);
  socketRoom.set(socket.id, room.code);
}

// ─── Game Flow ────────────────────────────────────────────────────────────────
function startGame(room) {
  room.phase = 'playing';
  room.screenshots = [];
  room.currentRound = 0;

  // Build drawer order from connected players, shuffled
  room.drawerOrder = shuffle([...room.players.keys()].filter(id => room.players.get(id).connected));
  room.drawerIndex = 0;

  // Reset scores
  for (const p of room.players.values()) {
    p.score = 0;
    p.hasGuessed = false;
  }

  io.to(room.code).emit('game-starting', {});
  setTimeout(() => startRound(room, 1), 500);
}

function startRound(room, roundNum) {
  room.currentRound = roundNum;

  // Reset hasGuessed for all players
  for (const p of room.players.values()) {
    p.hasGuessed = false;
  }

  io.to(room.code).emit('round-start', {
    round: roundNum,
    totalRounds: room.config.rounds,
  });

  setTimeout(() => startTurn(room), 1000);
}

function startTurn(room) {
  // Skip disconnected drawers
  while (
    room.drawerIndex < room.drawerOrder.length &&
    !room.players.get(room.drawerOrder[room.drawerIndex])?.connected
  ) {
    room.drawerIndex++;
  }

  if (room.drawerIndex >= room.drawerOrder.length) {
    // All drawers in this round done
    if (room.currentRound < room.config.rounds) {
      // Keep same drawer order each round; filter out anyone who disconnected
      room.drawerOrder = room.drawerOrder.filter(id => room.players.get(id)?.connected);
      room.drawerIndex = 0;
      startRound(room, room.currentRound + 1);
    } else {
      endGame(room);
    }
    return;
  }

  const drawerId = room.drawerOrder[room.drawerIndex];
  const drawer = room.players.get(drawerId);
  if (!drawer) {
    room.drawerIndex++;
    startTurn(room);
    return;
  }

  room.phase = 'choosing';
  room.strokeHistory = [];
  room.guessedCount = 0;
  room.screenshotReceived = false;

  // Reset hasGuessed for non-drawers
  for (const [id, p] of room.players.entries()) {
    if (id !== drawerId) p.hasGuessed = false;
  }

  room.wordChoices = pickWords(3);

  // Notify drawer of word choices
  io.to(drawerId).emit('word-choices', {
    words: room.wordChoices,
    drawerId,
    drawerName: drawer.name,
  });

  // Notify others that drawer is choosing
  io.to(room.code).except(drawerId).emit('chat-message', {
    id: Date.now(),
    name: 'Game',
    message: `${drawer.name} is choosing a word...`,
    type: 'system',
  });

  io.to(room.code).emit('drawer-choosing', {
    drawerId,
    drawerName: drawer.name,
    round: room.currentRound,
    totalRounds: room.config.rounds,
  });

  // Auto-pick if drawer doesn't choose in time
  room.choiceTimer = setTimeout(() => {
    if (room.phase === 'choosing') {
      beginDrawing(room, room.wordChoices[0]);
    }
  }, 15000);
}

function beginDrawing(room, word) {
  if (room.choiceTimer) {
    clearTimeout(room.choiceTimer);
    room.choiceTimer = null;
  }

  room.phase = 'drawing';
  room.currentWord = word;
  room.turnStartTime = Date.now() + 3000; // account for countdown

  const drawerId = room.drawerOrder[room.drawerIndex];
  const drawer = room.players.get(drawerId);

  const hint = makeHint(word);

  // Send word to drawer, hint to others
  const turnScores = getPlayersArray(room);

  io.to(drawerId).emit('turn-start', {
    drawerId,
    drawerName: drawer?.name || 'Unknown',
    word,
    hint,
    isDrawer: true,
    timeLimit: room.config.timeLimit,
    round: room.currentRound,
    totalRounds: room.config.rounds,
    strokeHistory: [],
    scores: turnScores,
  });

  io.to(room.code).except(drawerId).emit('turn-start', {
    drawerId,
    drawerName: drawer?.name || 'Unknown',
    hint,
    isDrawer: false,
    timeLimit: room.config.timeLimit,
    round: room.currentRound,
    totalRounds: room.config.rounds,
    strokeHistory: [],
    scores: turnScores,
  });

  // Run countdown 3-2-1
  let count = 3;
  const countdownInterval = setInterval(() => {
    io.to(room.code).emit('countdown', { count });
    count--;
    if (count < 0) {
      clearInterval(countdownInterval);
      room.turnStartTime = Date.now();
      startDrawingTimer(room);
    }
  }, 1000);
}

function startDrawingTimer(room) {
  let timeLeft = room.config.timeLimit;

  io.to(room.code).emit('timer-update', { timeLeft });

  room.timer = setInterval(() => {
    timeLeft--;
    io.to(room.code).emit('timer-update', { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(room.timer);
      room.timer = null;
      endTurn(room, false);
    }
  }, 1000);
}

function checkAllGuessed(room) {
  const drawerId = room.drawerOrder[room.drawerIndex];
  const connectedNonDrawers = [...room.players.entries()].filter(
    ([id, p]) => id !== drawerId && p.connected
  );

  if (connectedNonDrawers.length === 0) return false;
  return connectedNonDrawers.every(([, p]) => p.hasGuessed);
}

function endTurn(room, allGuessed) {
  if (room.phase === 'reveal' || room.phase === 'waiting' || room.phase === 'end') return;

  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }
  if (room.choiceTimer) {
    clearTimeout(room.choiceTimer);
    room.choiceTimer = null;
  }

  room.phase = 'reveal';

  const drawerId = room.drawerOrder[room.drawerIndex];
  const drawer = room.players.get(drawerId);

  // Drawer earns points for each guesser
  if (drawer && room.guessedCount > 0) {
    drawer.score += room.guessedCount * 100;
  }

  const scores = getPlayersArray(room);

  // Broadcast turn end with word reveal
  io.to(room.code).emit('turn-end', {
    word: room.currentWord,
    scores,
    drawerId,
  });

  // Store which drawer we're waiting on, for screenshot validation
  room.revealDrawerId = drawerId;

  // Request screenshot from drawer if connected
  if (!drawer?.connected) {
    room.screenshotReceived = true;
    finalizeTurn(room);
    return;
  }

  // Timeout if screenshot never arrives
  const screenshotTimeout = setTimeout(() => {
    if (!room.screenshotReceived) {
      room.screenshotReceived = true;
      finalizeTurn(room);
    }
  }, 5000);

  room._screenshotTimeout = screenshotTimeout;
}

function storeScreenshot(room, imageData) {
  if (room.screenshotReceived) return;
  room.screenshotReceived = true;

  if (room._screenshotTimeout) {
    clearTimeout(room._screenshotTimeout);
    room._screenshotTimeout = null;
  }

  const drawer = room.players.get(room.revealDrawerId);

  room.screenshots.push({
    word: room.currentWord,
    drawer: drawer?.name || 'Unknown',
    round: room.currentRound,
    imageData,
  });

  finalizeTurn(room);
}

function finalizeTurn(room) {
  room.drawerIndex++;
  setTimeout(() => {
    if (room.phase !== 'reveal') return;
    startTurn(room);
  }, 4000);
}

function endGame(room) {
  room.phase = 'end';

  if (room.timer) {
    clearInterval(room.timer);
    room.timer = null;
  }

  const finalScores = getPlayersArray(room).sort((a, b) => b.score - a.score);

  // Persist drawings to gallery DB
  for (const s of room.screenshots) {
    if (s.imageData) {
      insertItem.run(s.word, s.drawer, room.code, s.round, s.imageData);
    }
  }

  io.to(room.code).emit('game-end', {
    finalScores,
    screenshots: room.screenshots,
  });
}

function handleDisconnect(socket) {
  const code = socketRoom.get(socket.id);
  if (!code) return;

  const room = rooms.get(code);
  if (!room) return;

  const player = room.players.get(socket.id);
  if (!player) return;

  player.connected = false;
  socketRoom.delete(socket.id);

  const connected = getConnectedPlayers(room);

  if (connected.length === 0) {
    // Clean up room
    if (room.timer) clearInterval(room.timer);
    if (room.choiceTimer) clearTimeout(room.choiceTimer);
    rooms.delete(code);
    broadcastOpenRooms();
    return;
  }

  // Promote new host if needed
  let newHostId = null;
  if (room.hostId === socket.id) {
    room.hostId = connected[0].id;
    newHostId = room.hostId;
  }

  io.to(code).emit('player-left', {
    playerId: socket.id,
    playerName: player.name,
    players: getPlayersArray(room),
    newHostId,
  });

  if (room.phase === 'waiting') broadcastOpenRooms();

  // Handle mid-game disconnects
  if (room.phase === 'drawing' || room.phase === 'choosing') {
    const drawerId = room.drawerOrder[room.drawerIndex];

    if (drawerId === socket.id) {
      // Drawer left — end turn immediately
      endTurn(room, false);
    } else {
      // Non-drawer left — check if all remaining players have guessed
      if (checkAllGuessed(room)) {
        if (room.timer) {
          clearInterval(room.timer);
          room.timer = null;
        }
        endTurn(room, true);
      }
    }
  } else if (room.phase === 'reveal') {
    // Screenshot sender disconnected — just finalize
    if (!room.screenshotReceived) {
      room.screenshotReceived = true;
      finalizeTurn(room);
    }
  }

  // If only 1 player left and game was running, end it
  if (connected.length === 1 && room.phase !== 'waiting' && room.phase !== 'end') {
    endGame(room);
  }
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join-room', ({ username, roomCode }) => {
    if (!username || typeof username !== 'string') return;
    const name = username.trim().slice(0, 20);
    if (!name) return;

    let room;

    if (roomCode) {
      const code = roomCode.trim().toUpperCase();
      room = rooms.get(code);
      if (!room) {
        socket.emit('join-error', { message: 'Room not found.' });
        return;
      }
      if (room.phase !== 'waiting') {
        socket.emit('join-error', { message: 'Game already in progress.' });
        return;
      }
      addPlayerToRoom(room, socket, name);
    } else {
      room = createRoom(socket, name);
    }

    const isHost = room.hostId === socket.id;

    socket.emit('room-joined', {
      roomCode: room.code,
      players: getPlayersArray(room),
      isHost,
      config: room.config,
    });

    // Notify others
    const newPlayer = room.players.get(socket.id);
    socket.to(room.code).emit('player-joined', {
      player: { id: socket.id, name, score: 0, hasGuessed: false, avatarIndex: newPlayer.avatarIndex },
    });

    // System message
    io.to(room.code).emit('chat-message', {
      id: Date.now(),
      name: 'Game',
      message: `${name} joined the room.`,
      type: 'system',
    });

    broadcastOpenRooms();
  });

  socket.on('update-config', ({ rounds, timeLimit }) => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id || room.phase !== 'waiting') return;

    room.config.rounds = Math.min(10, Math.max(1, parseInt(rounds) || 3));
    room.config.timeLimit = Math.min(120, Math.max(30, parseInt(timeLimit) || 80));

    io.to(code).emit('config-updated', { config: room.config });
  });

  socket.on('start-game', () => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id || room.phase !== 'waiting') return;

    const connected = getConnectedPlayers(room);
    if (connected.length < 2) return;

    startGame(room);
    broadcastOpenRooms();
  });

  socket.on('choose-word', ({ word }) => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.phase !== 'choosing') return;

    const drawerId = room.drawerOrder[room.drawerIndex];
    if (drawerId !== socket.id) return;

    if (!room.wordChoices.includes(word)) return;

    beginDrawing(room, word);
  });

  socket.on('draw-stroke', (stroke) => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.phase !== 'drawing') return;

    const drawerId = room.drawerOrder[room.drawerIndex];
    if (drawerId !== socket.id) return;

    // Validate stroke data
    const s = {
      x0: Number(stroke.x0),
      y0: Number(stroke.y0),
      x1: Number(stroke.x1),
      y1: Number(stroke.y1),
      color: String(stroke.color || '#000000').slice(0, 20),
      size: Math.min(50, Math.max(1, Number(stroke.size) || 6)),
      tool: stroke.tool === 'eraser' ? 'eraser' : 'pen',
    };

    room.strokeHistory.push(s);
    socket.to(code).emit('stroke', s);
  });

  socket.on('clear-canvas', () => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.phase !== 'drawing') return;

    const drawerId = room.drawerOrder[room.drawerIndex];
    if (drawerId !== socket.id) return;

    room.strokeHistory = [];
    socket.to(code).emit('clear-canvas', {});
  });

  socket.on('submit-guess', ({ guess }) => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.phase !== 'drawing') return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const drawerId = room.drawerOrder[room.drawerIndex];
    if (socket.id === drawerId) return; // drawer can't guess
    if (player.hasGuessed) return; // already guessed

    const trimmed = String(guess || '').trim();
    if (!trimmed || trimmed.length > 100) return;

    const correct = trimmed.toLowerCase() === room.currentWord?.toLowerCase();

    if (correct) {
      player.hasGuessed = true;
      room.guessedCount++;

      // Calculate score based on time remaining
      const timeRemaining = getTimeRemaining(room);
      const isFirst = room.guessedCount === 1;
      let points = Math.floor(200 + 600 * (timeRemaining / room.config.timeLimit));
      if (isFirst) points += 50; // first guesser bonus
      player.score += points;

      // Tell guesser their result
      socket.emit('guess-result', { correct: true, points });

      // Notify everyone (without revealing the word)
      io.to(code).emit('player-guessed', {
        playerId: socket.id,
        playerName: player.name,
        points,
        scores: getPlayersArray(room),
      });

      io.to(code).emit('chat-message', {
        id: Date.now(),
        name: player.name,
        message: `guessed the word! (+${points} pts)`,
        type: 'correct',
      });

      if (checkAllGuessed(room)) {
        if (room.timer) {
          clearInterval(room.timer);
          room.timer = null;
        }
        setTimeout(() => endTurn(room, true), 1000);
      }
    } else {
      // Broadcast guess as chat
      io.to(code).emit('chat-message', {
        id: Date.now(),
        name: player.name,
        message: trimmed,
        type: 'chat',
      });

      // Close guess hint (within 1 edit distance ignoring case)
      if (room.currentWord && isCloseGuess(trimmed, room.currentWord)) {
        socket.emit('chat-message', {
          id: Date.now(),
          name: 'Game',
          message: `You're close!`,
          type: 'close',
        });
      }

      socket.emit('guess-result', { correct: false });
    }
  });

  socket.on('canvas-screenshot', ({ imageData }) => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.phase !== 'reveal') return;
    if (socket.id !== room.revealDrawerId) return;

    if (typeof imageData === 'string' && imageData.startsWith('data:image/png;base64,')) {
      storeScreenshot(room, imageData);
    } else {
      room.screenshotReceived = true;
      finalizeTurn(room);
    }
  });

  socket.on('play-again', () => {
    const code = socketRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.hostId !== socket.id || room.phase !== 'end') return;

    room.phase = 'waiting';
    room.screenshots = [];
    room.strokeHistory = [];
    room.currentWord = null;
    room.currentRound = 0;
    room.drawerOrder = [];
    room.drawerIndex = 0;
    room.guessedCount = 0;

    for (const p of room.players.values()) {
      p.score = 0;
      p.hasGuessed = false;
    }

    io.to(code).emit('room-reset', {
      players: getPlayersArray(room),
      config: room.config,
    });

    broadcastOpenRooms();
  });

  socket.on('get-open-rooms', () => {
    socket.emit('open-rooms', getOpenRooms());
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket);
  });
});

// ─── Close guess detection ────────────────────────────────────────────────────
function isCloseGuess(guess, word) {
  const g = guess.toLowerCase();
  const w = word.toLowerCase();
  if (Math.abs(g.length - w.length) > 2) return false;
  return levenshtein(g, w) === 1;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ─── Gallery Routes ───────────────────────────────────────────────────────────
app.get('/gallery', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gallery.html'));
});

app.get('/api/gallery/drawers', (_req, res) => {
  const drawers = selectDrawers.all().map(r => r.drawer);
  res.json({ drawers });
});

app.get('/api/gallery', (req, res) => {
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit)  || 48));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const drawer = req.query.drawer ? String(req.query.drawer) : null;
  const items  = drawer ? selectItemsByDrawer.all(drawer, limit, offset) : selectItems.all(limit, offset);
  const { total } = drawer ? countItemsByDrawer.get(drawer) : countItems.get();
  res.json({ items, total, limit, offset });
});

app.get('/api/gallery/:id/image', (req, res) => {
  const row = selectItemById.get(parseInt(req.params.id));
  if (!row) return res.status(404).end();
  // image_data is "data:image/png;base64,..."
  const base64 = row.image_data.replace(/^data:image\/png;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(buf);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎨 Skribbl Clone running at http://localhost:${PORT}`);
  console.log(`   Share with coworkers on your local network!\n`);
});
