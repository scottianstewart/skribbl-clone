"use strict";

// ─── Sounds ───────────────────────────────────────────────────────────────────
const SOUNDS = {
  roundStart: new Audio("/sounds/round-start.mp3"),
  fiveSeconds: new Audio("/sounds/countdown-tick.mp3"),
  roundEnd: new Audio("/sounds/round-end.mp3"),
  correctGuess: new Audio("/sounds/correct-guess.mp3"),
  gameEnd: new Audio("/sounds/game-end.mp3"),
  countdownTick: new Audio("/sounds/countdown-tick.mp3"),
};

let masterVolume = parseFloat(localStorage.getItem("masterVolume") ?? "0.2");

function playSound(name) {
  const snd = SOUNDS[name];
  if (!snd) return;
  snd.volume = masterVolume;
  snd.currentTime = 0;
  snd.play().catch(() => {}); // ignore autoplay policy errors
}

let fiveSecondPlayed = false;
let prevScores = {}; // score snapshot at turn start for delta calculation
let scoreOverlayTimeout = null;

// ─── Socket & State ───────────────────────────────────────────────────────────
const socket = io();

let myId = null;
let myName = "";
let roomCode = "";
let isHost = false;
let isDrawer = false;
let currentConfig = { rounds: 3, timeLimit: 80 };
let totalTimeLimit = 80;
let timerValue = 80;

// Local player tracking for waiting room
const waitingPlayers = new Map();

// Canvas drawing state
let currentColor = "#000000";
let currentSize = 4;
let currentTool = "pen";
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// ─── DOM References ───────────────────────────────────────────────────────────
const lobbyScreen = document.getElementById("screen-lobby");
const waitingScreen = document.getElementById("screen-waiting");
const gameScreen = document.getElementById("screen-game");
const endScreen = document.getElementById("screen-end");

const usernameInput = document.getElementById("username-input");
const roomCodeInput = document.getElementById("room-code-input");
const btnCreate = document.getElementById("btn-create");
const btnJoin = document.getElementById("btn-join");
const lobbyError = document.getElementById("lobby-error");
const openRoomsSection = document.getElementById("open-rooms-section");
const openRoomsList = document.getElementById("open-rooms-list");

// ─── Persisted Name ───────────────────────────────────────────────────────────
const savedName = localStorage.getItem("playerName");
if (savedName) usernameInput.value = savedName;

const displayRoomCode = document.getElementById("display-room-code");
const btnCopyCode = document.getElementById("btn-copy-code");
const playerCountEl = document.getElementById("player-count");
const waitingList = document.getElementById("waiting-player-list");
const hostConfig = document.getElementById("host-config");
const guestWaiting = document.getElementById("guest-waiting");
const cfgRounds = document.getElementById("cfg-rounds");
const cfgRoundsVal = document.getElementById("cfg-rounds-val");
const cfgTime = document.getElementById("cfg-time");
const cfgTimeVal = document.getElementById("cfg-time-val");
const btnStart = document.getElementById("btn-start");

const roundIndicator = document.getElementById("round-indicator");
const currentRoundEl = document.getElementById("current-round");
const totalRoundsEl = document.getElementById("total-rounds");
const wordHint = document.getElementById("word-hint");
const drawerChoosingMsg = document.getElementById("drawer-choosing-msg");
const choosingName = document.getElementById("choosing-name");
const wordChoicesEl = document.getElementById("word-choices");
const timerNumber = document.getElementById("timer-number");
const timerBar = document.getElementById("timer-bar");
const timerBarTrack = document.getElementById("timer-bar-track");
const scoreList = document.getElementById("score-list");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const toolPanel = document.getElementById("tool-panel");
const colorPalette = document.getElementById("color-palette");
const brushSizeBtns = document.querySelectorAll(".size-btn");
const btnEraser = document.getElementById("btn-eraser");
const btnClear = document.getElementById("btn-clear");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const countdownOverlay = document.getElementById("countdown-overlay");
const countdownNumber = document.getElementById("countdown-number");

const choosingOverlay = document.getElementById("choosing-overlay");
const choosingOverlayName = document.getElementById("choosing-overlay-name");
const wordChoiceOverlay = document.getElementById("word-choice-overlay");
const wordChoiceBtns = document.getElementById("word-choice-btns");

const scoreOverlay = document.getElementById("score-overlay");
const scoreOverlayRows = document.getElementById("score-overlay-rows");
const volumeSlider = document.getElementById("volume-slider");
const volumeIcon = document.getElementById("volume-icon");

// ─── Volume Control ───────────────────────────────────────────────────────────
volumeSlider.value = masterVolume;
updateVolumeIcon(masterVolume);

volumeSlider.addEventListener("input", () => {
  masterVolume = parseFloat(volumeSlider.value);
  localStorage.setItem("masterVolume", masterVolume);
  updateVolumeIcon(masterVolume);
});

volumeIcon.addEventListener("click", () => {
  masterVolume =
    masterVolume > 0
      ? 0
      : parseFloat(localStorage.getItem("masterVolume") || "0.7");
  volumeSlider.value = masterVolume;
  updateVolumeIcon(masterVolume);
});

function updateVolumeIcon(vol) {
  if (vol === 0) volumeIcon.textContent = "🔇";
  else if (vol < 0.4) volumeIcon.textContent = "🔉";
  else volumeIcon.textContent = "🔊";
}

const finalScoreList = document.getElementById("final-score-list");
const galleryGrid = document.getElementById("gallery-grid");
const btnPlayAgain = document.getElementById("btn-play-again");

// ─── Screen Management ────────────────────────────────────────────────────────
function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ─── Color Palette Setup ──────────────────────────────────────────────────────
const COLORS = [
  "#000000",
  "#ffffff",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
  "#78716c",
  "#94a3b8",
  "#6d28d9",
  "#065f46",
  "#92400e",
  "#1e3a5f",
  "#fde68a",
  "#bbf7d0",
];

function buildColorPalette() {
  colorPalette.innerHTML = "";
  COLORS.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.className =
      "color-swatch" + (color === currentColor ? " active" : "");
    swatch.style.background = color;
    swatch.title = color;
    swatch.addEventListener("click", () => {
      currentTool = "pen";
      currentColor = color;
      btnEraser.classList.remove("active");
      document
        .querySelectorAll(".color-swatch")
        .forEach((s) => s.classList.remove("active"));
      swatch.classList.add("active");
    });
    colorPalette.appendChild(swatch);
  });
}

// ─── Canvas Utilities ─────────────────────────────────────────────────────────
function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function drawStroke(x0, y0, x1, y1, color, size, tool) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
  ctx.lineWidth = tool === "eraser" ? size * 3 : size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function replayStrokes(strokes) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  strokes.forEach((s) =>
    drawStroke(s.x0, s.y0, s.x1, s.y1, s.color, s.size, s.tool),
  );
}

// ─── Canvas Events ────────────────────────────────────────────────────────────
function startStroke(e) {
  if (!isDrawer) return;
  e.preventDefault();
  isDrawing = true;
  const { x, y } = getCanvasPos(e);
  lastX = x;
  lastY = y;
}

function continueStroke(e) {
  if (!isDrawer || !isDrawing) return;
  e.preventDefault();
  const { x, y } = getCanvasPos(e);
  drawStroke(lastX, lastY, x, y, currentColor, currentSize, currentTool);
  socket.emit("draw-stroke", {
    x0: lastX,
    y0: lastY,
    x1: x,
    y1: y,
    color: currentColor,
    size: currentSize,
    tool: currentTool,
  });
  lastX = x;
  lastY = y;
}

function endStroke() {
  isDrawing = false;
}

canvas.addEventListener("mousedown", startStroke);
canvas.addEventListener("mousemove", continueStroke);
canvas.addEventListener("mouseup", endStroke);
canvas.addEventListener("mouseleave", endStroke);
canvas.addEventListener("touchstart", startStroke, { passive: false });
canvas.addEventListener("touchmove", continueStroke, { passive: false });
canvas.addEventListener("touchend", endStroke);

// ─── Tool Controls ────────────────────────────────────────────────────────────
brushSizeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    brushSizeBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentSize = parseInt(btn.dataset.size);
    currentTool = "pen";
    btnEraser.classList.remove("active");
    // Re-activate last selected color swatch
    const activeSwatch = colorPalette.querySelector(".color-swatch.active");
    if (!activeSwatch) {
      const firstSwatch = colorPalette.querySelector(".color-swatch");
      if (firstSwatch) firstSwatch.classList.add("active");
    }
  });
});

btnEraser.addEventListener("click", () => {
  currentTool = currentTool === "eraser" ? "pen" : "eraser";
  btnEraser.classList.toggle("active", currentTool === "eraser");
});

btnClear.addEventListener("click", () => {
  if (!isDrawer) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  socket.emit("clear-canvas");
});

// ─── Chat ─────────────────────────────────────────────────────────────────────
function sendGuess() {
  const text = chatInput.value.trim();
  if (!text) return;
  if (!isDrawer) {
    socket.emit("submit-guess", { guess: text });
  }
  chatInput.value = "";
}

btnSend.addEventListener("click", sendGuess);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendGuess();
});

function addChatMessage({ name, message, type }) {
  const div = document.createElement("div");
  div.className = `chat-msg type-${type}`;

  if (type === "chat") {
    div.innerHTML = `<span class="msg-name">${escHtml(name)}:</span> ${escHtml(message)}`;
  } else if (type === "correct") {
    div.innerHTML = `🎉 <span class="msg-name">${escHtml(name)}</span> ${escHtml(message)}`;
  } else if (type === "system") {
    div.textContent = message;
  } else if (type === "close") {
    div.textContent = message;
  }

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Avatars ──────────────────────────────────────────────────────────────────
const AVATARS = [
  { emoji: "🎨", color: "#e8a87c" }, // Painter
  { emoji: "✏️", color: "#7ec8e3" }, // Sketcher
  { emoji: "🖌️", color: "#a8e6cf" }, // Brushmaster
  { emoji: "🖍️", color: "#f9c784" }, // Crayon
  { emoji: "🗿", color: "#c5b8a8" }, // Sculptor
  { emoji: "🖊️", color: "#b5a4d0" }, // Inker
  { emoji: "🎭", color: "#ffaaa5" }, // Dramatist
  { emoji: "🖼️", color: "#d4c5a9" }, // Framer
];

function avatarHtml(idx) {
  const a = AVATARS[(idx ?? 0) % AVATARS.length];
  return `<span class="player-avatar" style="background:${a.color}" title="${a.emoji}">${a.emoji}</span>`;
}

// ─── Scoreboard ───────────────────────────────────────────────────────────────
function updateScoreboard(players, drawerId) {
  scoreList.innerHTML = "";
  const sorted = [...players].sort((a, b) => b.score - a.score);
  sorted.forEach((p) => {
    const li = document.createElement("li");
    li.className = "score-item";
    if (p.id === drawerId) li.classList.add("is-drawer");
    if (p.hasGuessed && p.id !== drawerId) li.classList.add("guessed");

    li.innerHTML = `
      ${avatarHtml(p.avatarIndex)}
      <span class="score-name">${escHtml(p.name)}</span>
      <span class="score-pts">${p.score}</span>
    `;
    scoreList.appendChild(li);
  });
}

// ─── Hint display ─────────────────────────────────────────────────────────────
function showHint(hint) {
  wordHint.textContent = hint;
  wordHint.classList.remove("hidden");
  drawerChoosingMsg.classList.add("hidden");
  wordChoicesEl.classList.add("hidden");
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function updateTimer(timeLeft) {
  timerValue = timeLeft;
  timerNumber.textContent = timeLeft;
  const pct = (timeLeft / totalTimeLimit) * 100;
  timerBar.style.width = pct + "%";

  const warn = timeLeft <= 15;
  const danger = timeLeft <= 8;
  timerNumber.classList.toggle("warning", warn && !danger);
  timerNumber.classList.toggle("danger", danger);
  timerBar.classList.toggle("warning", warn && !danger);
  timerBar.classList.toggle("danger", danger);
}

// ─── Countdown animation ──────────────────────────────────────────────────────
let countdownActive = false;

function showCountdown(count) {
  countdownOverlay.classList.remove("hidden");
  countdownActive = true;

  if (count === 0 || count === "Draw!") {
    countdownNumber.textContent = "Draw!";
    setTimeout(() => {
      countdownOverlay.classList.add("hidden");
      countdownActive = false;
    }, 900);
  } else {
    countdownNumber.textContent = count;
    // Reset animation
    countdownNumber.style.animation = "none";
    void countdownNumber.offsetHeight; // reflow
    countdownNumber.style.animation = "";
  }
}

// ─── Waiting Room Player List ─────────────────────────────────────────────────
function renderWaitingPlayers(players) {
  waitingList.innerHTML = "";
  playerCountEl.textContent = players.length;
  players.forEach((p) => {
    const li = document.createElement("li");
    if (p.id === myId) li.classList.add("me");
    li.innerHTML = `
      ${avatarHtml(p.avatarIndex)}
      ${escHtml(p.name)}${p.id === myId ? " (you)" : ""}
    `;
    waitingList.appendChild(li);
  });

  if (isHost) {
    const connected = players.length;
    btnStart.disabled = connected < 2;
    btnStart.textContent =
      connected < 2
        ? "Start Game (need 2+ players)"
        : `Start Game (${connected} players)`;
  }
}

let roomHostId = null;

// ─── Lobby Events ─────────────────────────────────────────────────────────────
btnCreate.addEventListener("click", () => {
  const name = usernameInput.value.trim();
  if (!name) {
    showLobbyError("Please enter a name.");
    return;
  }
  localStorage.setItem("playerName", name);
  socket.emit("join-room", { username: name });
});

btnJoin.addEventListener("click", () => {
  const name = usernameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) {
    showLobbyError("Please enter a name.");
    return;
  }
  if (!code || code.length !== 4) {
    showLobbyError("Enter a valid 4-letter room code.");
    return;
  }
  localStorage.setItem("playerName", name);
  socket.emit("join-room", { username: name, roomCode: code });
});

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (roomCodeInput.value.trim()) btnJoin.click();
    else btnCreate.click();
  }
});
roomCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") btnJoin.click();
});
roomCodeInput.addEventListener("input", (e) => {
  e.target.value = e.target.value.toUpperCase();
});

function renderOpenRooms(rooms) {
  if (rooms.length === 0) {
    openRoomsSection.classList.add("hidden");
    return;
  }
  openRoomsSection.classList.remove("hidden");
  openRoomsList.innerHTML = "";
  rooms.forEach((r) => {
    const li = document.createElement("li");
    li.className = "open-room-row";
    li.innerHTML = `
      <div class="open-room-info">
        <span class="open-room-host">${escHtml(r.hostName)}'s room</span>
        <span class="open-room-meta">${r.playerCount} player${r.playerCount !== 1 ? "s" : ""} · ${r.config.rounds} rounds · ${r.config.timeLimit}s</span>
      </div>
      <button class="btn btn-secondary open-room-join">Join</button>
    `;
    li.addEventListener("click", () => {
      const name = usernameInput.value.trim();
      if (!name) {
        showLobbyError("Please enter a name first.");
        usernameInput.focus();
        return;
      }
      localStorage.setItem("playerName", name);
      socket.emit("join-room", { username: name, roomCode: r.code });
    });
    openRoomsList.appendChild(li);
  });
}

function showLobbyError(msg) {
  lobbyError.textContent = msg;
  lobbyError.classList.remove("hidden");
  setTimeout(() => lobbyError.classList.add("hidden"), 3500);
}

btnCopyCode.addEventListener("click", () => {
  navigator.clipboard.writeText(roomCode).then(() => {
    btnCopyCode.textContent = "✅";
    setTimeout(() => {
      btnCopyCode.textContent = "📋";
    }, 1500);
  });
});

cfgRounds.addEventListener("input", () => {
  cfgRoundsVal.textContent = cfgRounds.value;
  socket.emit("update-config", {
    rounds: cfgRounds.value,
    timeLimit: cfgTime.value,
  });
});
cfgTime.addEventListener("input", () => {
  cfgTimeVal.textContent = cfgTime.value + "s";
  socket.emit("update-config", {
    rounds: cfgRounds.value,
    timeLimit: cfgTime.value,
  });
});

btnStart.addEventListener("click", () => {
  socket.emit("start-game");
});

btnPlayAgain.addEventListener("click", () => {
  socket.emit("play-again");
});

// ─── Turn Score Overlay ───────────────────────────────────────────────────────
function hideScoreOverlay() {
  clearTimeout(scoreOverlayTimeout);
  scoreOverlay.style.opacity = "0";
}

function showScoreOverlay(scores) {
  const rows = scores
    .map((p) => ({ ...p, delta: p.score - (prevScores[p.id] ?? p.score) }))
    .sort((a, b) => b.delta - a.delta);

  scoreOverlayRows.innerHTML = rows
    .map(
      (p) => `
    <div class="score-delta-row">
      ${avatarHtml(p.avatarIndex)}
      <span class="score-delta-name">${escHtml(p.name)}</span>
      <span class="score-delta-pts${p.delta === 0 ? " zero" : ""}">${p.delta > 0 ? "+" : ""}${p.delta}</span>
    </div>`,
    )
    .join("");

  clearTimeout(scoreOverlayTimeout);
  scoreOverlay.style.opacity = "1";
  scoreOverlayTimeout = setTimeout(() => {
    scoreOverlay.style.opacity = "0";
  }, 4000);
}

// ─── Socket Events ────────────────────────────────────────────────────────────
socket.on("connect", () => {
  socket.emit("get-open-rooms");
});

socket.on("open-rooms", (rooms) => {
  renderOpenRooms(rooms);
});

socket.on(
  "room-joined",
  ({ roomCode: code, players, isHost: host, config }) => {
    myId = socket.id;
    roomCode = code;
    isHost = host;
    currentConfig = config;
    roomHostId =
      players.find((p) => p.id === myId && host)?.id || players[0]?.id;
    // find actual host
    const me = players.find((p) => p.id === myId);
    myName = me?.name || "";

    displayRoomCode.textContent = code;

    if (isHost) {
      hostConfig.classList.remove("hidden");
      guestWaiting.classList.add("hidden");
      cfgRounds.value = config.rounds;
      cfgRoundsVal.textContent = config.rounds;
      cfgTime.value = config.timeLimit;
      cfgTimeVal.textContent = config.timeLimit + "s";
      // We need the host id to mark it
      roomHostId = myId;
    } else {
      hostConfig.classList.add("hidden");
      guestWaiting.classList.remove("hidden");
    }

    waitingPlayers.clear();
    players.forEach((p) => waitingPlayers.set(p.id, p));
    renderWaitingPlayers(players);
    showScreen("screen-waiting");
  },
);

socket.on("join-error", ({ message }) => {
  showLobbyError(message);
});

socket.on("player-joined", ({ player }) => {
  waitingPlayers.set(player.id, player);
  renderWaitingPlayers([...waitingPlayers.values()]);
});

socket.on("player-left", ({ playerId, playerName, players, newHostId }) => {
  waitingPlayers.delete(playerId);
  if (newHostId) {
    roomHostId = newHostId;
    if (newHostId === myId) {
      isHost = true;
      hostConfig.classList.remove("hidden");
      guestWaiting.classList.add("hidden");
    }
  }
  renderWaitingPlayers(players || [...waitingPlayers.values()]);
  if (players) {
    waitingPlayers.clear();
    players.forEach((p) => waitingPlayers.set(p.id, p));
  }
});

socket.on("config-updated", ({ config }) => {
  currentConfig = config;
  totalTimeLimit = config.timeLimit;
  if (isHost) {
    cfgRounds.value = config.rounds;
    cfgRoundsVal.textContent = config.rounds;
    cfgTime.value = config.timeLimit;
    cfgTimeVal.textContent = config.timeLimit + "s";
  }
});

socket.on("host-changed", ({ newHostId }) => {
  roomHostId = newHostId;
  if (newHostId === myId) {
    isHost = true;
    hostConfig.classList.remove("hidden");
    guestWaiting.classList.add("hidden");
  }
});

// ─── Game Events ──────────────────────────────────────────────────────────────
let currentDrawerId = null;

socket.on("game-starting", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  chatMessages.innerHTML = "";
  showScreen("screen-game");
  buildColorPalette();
  toolPanel.classList.add("hidden");
  chatInput.disabled = false;
});

socket.on("round-start", ({ round, totalRounds }) => {
  currentRoundEl.textContent = round;
  totalRoundsEl.textContent = totalRounds;
  totalTimeLimit = currentConfig.timeLimit;
  addChatMessage({
    name: "Game",
    message: `Round ${round} of ${totalRounds}`,
    type: "system",
  });
});

socket.on("drawer-choosing", ({ drawerId, drawerName, round, totalRounds }) => {
  currentDrawerId = drawerId;
  currentRoundEl.textContent = round;
  totalRoundsEl.textContent = totalRounds;

  wordHint.classList.add("hidden");

  if (drawerId === myId) {
    // word-choices arrives before this event — don't hide it
    drawerChoosingMsg.classList.add("hidden");
  } else {
    wordChoicesEl.classList.add("hidden");
    drawerChoosingMsg.classList.remove("hidden");
    choosingName.textContent = drawerName;
    choosingOverlayName.textContent = drawerName;
    choosingOverlay.style.opacity = "1";
  }
});

socket.on("word-choices", ({ words, drawerId, drawerName }) => {
  // Only the drawer receives this
  isDrawer = true;
  currentDrawerId = drawerId;

  drawerChoosingMsg.classList.add("hidden");
  wordHint.classList.add("hidden");
  wordChoicesEl.classList.add("hidden");

  // Show word choices as an overlay on the canvas
  wordChoiceBtns.innerHTML = "";
  words.forEach((word) => {
    const btn = document.createElement("button");
    btn.className = "word-choice-btn";
    btn.textContent = word;
    btn.addEventListener("click", () => {
      socket.emit("choose-word", { word });
      wordChoiceOverlay.classList.add("hidden");
    });
    wordChoiceBtns.appendChild(btn);
  });
  wordChoiceOverlay.classList.remove("hidden");

  addChatMessage({
    name: "Game",
    message: "Choose a word to draw!",
    type: "system",
  });
});

socket.on(
  "turn-start",
  ({
    drawerId,
    drawerName,
    word,
    hint,
    isDrawer: amDrawer,
    timeLimit,
    round,
    totalRounds,
    strokeHistory,
    scores,
  }) => {
    currentDrawerId = drawerId;
    isDrawer = amDrawer;
    totalTimeLimit = timeLimit;

    wordChoicesEl.classList.add("hidden");
    wordChoiceOverlay.classList.add("hidden");
    drawerChoosingMsg.classList.add("hidden");
    countdownOverlay.classList.add("hidden");
    choosingOverlay.style.opacity = "0";

    currentRoundEl.textContent = round;
    totalRoundsEl.textContent = totalRounds;

    // Replay stroke history (for late joiners)
    if (strokeHistory && strokeHistory.length > 0) {
      replayStrokes(strokeHistory);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (amDrawer) {
      // Show actual word
      wordHint.textContent = word;
      wordHint.classList.remove("hidden");
      canvas.classList.remove("is-viewer");
      toolPanel.classList.remove("hidden");
      chatInput.disabled = true;
      chatInput.placeholder = "You are drawing!";
      buildColorPalette();
    } else {
      showHint(hint);
      canvas.classList.add("is-viewer");
      toolPanel.classList.add("hidden");
      chatInput.disabled = false;
      chatInput.placeholder = "Type your guess…";
    }

    addChatMessage({
      name: "Game",
      message: `${drawerName} is drawing now!`,
      type: "system",
    });
    updateScoreboard(scores || [], drawerId);

    // Reset timer bar
    timerBar.style.width = "100%";
    timerBar.className = "";
    timerNumber.className = "";
    timerNumber.textContent = timeLimit;

    // Snapshot scores for turn-end delta display
    prevScores = {};
    (scores || []).forEach((p) => {
      prevScores[p.id] = p.score;
    });

    hideScoreOverlay();
    fiveSecondPlayed = false;
  },
);

socket.on("countdown", ({ count }) => {
  showCountdown(count === 0 ? "Draw!" : count);
  if (count === 0) playSound("roundStart");
  else playSound("countdownTick");
});

socket.on("stroke", (stroke) => {
  drawStroke(
    stroke.x0,
    stroke.y0,
    stroke.x1,
    stroke.y1,
    stroke.color,
    stroke.size,
    stroke.tool,
  );
});

socket.on("clear-canvas", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
});

socket.on("timer-update", ({ timeLeft }) => {
  updateTimer(timeLeft);
  if (timeLeft === 5 && !fiveSecondPlayed) {
    fiveSecondPlayed = true;
    playSound("fiveSeconds");
  }
});

socket.on("chat-message", ({ id, name, message, type }) => {
  addChatMessage({ name, message, type });
});

socket.on("player-guessed", ({ playerId, playerName, points, scores }) => {
  playSound("correctGuess");
  updateScoreboard(scores, currentDrawerId);
});

socket.on("guess-result", ({ correct, points }) => {
  if (correct) {
    chatInput.disabled = true;
    chatInput.placeholder = `Correct! +${points} pts`;
  }
});

socket.on("turn-end", ({ word, scores, drawerId }) => {
  playSound("roundEnd");
  showScoreOverlay(scores);
  // Reveal word to everyone
  wordHint.textContent = word;
  wordHint.classList.remove("hidden");
  wordChoicesEl.classList.add("hidden");

  addChatMessage({
    name: "Game",
    message: `The word was: "${word}"`,
    type: "system",
  });

  updateScoreboard(scores, drawerId);

  // Send screenshot if drawer
  if (isDrawer) {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = () => {
        socket.emit("canvas-screenshot", { imageData: reader.result });
      };
      reader.readAsDataURL(blob);
    }, "image/png");
  }

  // Reset drawer state
  isDrawer = false;
  toolPanel.classList.add("hidden");
  canvas.classList.add("is-viewer");
  chatInput.disabled = false;
  chatInput.placeholder = "Type your guess…";
});

socket.on("game-end", ({ finalScores, screenshots }) => {
  Object.values(SOUNDS).forEach((snd) => {
    snd.pause();
    snd.currentTime = 0;
  });
  showScreen("screen-end");
  playSound("gameEnd");
  renderLeaderboard(finalScores);
  renderGallery(screenshots);
  if (isHost) {
    btnPlayAgain.classList.remove("hidden");
  }
});

socket.on("room-reset", ({ players, config }) => {
  currentConfig = config;
  totalTimeLimit = config.timeLimit;
  isDrawer = false;
  currentDrawerId = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  chatMessages.innerHTML = "";
  toolPanel.classList.add("hidden");

  waitingPlayers.clear();
  players.forEach((p) => waitingPlayers.set(p.id, p));

  // Update config UI if host
  if (isHost) {
    hostConfig.classList.remove("hidden");
    guestWaiting.classList.add("hidden");
    cfgRounds.value = config.rounds;
    cfgRoundsVal.textContent = config.rounds;
    cfgTime.value = config.timeLimit;
    cfgTimeVal.textContent = config.timeLimit + "s";
    btnPlayAgain.classList.add("hidden");
  }

  renderWaitingPlayers(players);
  showScreen("screen-waiting");
});

// ─── Leaderboard ──────────────────────────────────────────────────────────────
const RANK_ICONS = ["🥇", "🥈", "🥉"];

function renderLeaderboard(scores) {
  finalScoreList.innerHTML = "";
  scores.forEach((p, i) => {
    const li = document.createElement("li");
    li.className = "final-score-item";
    li.innerHTML = `
      <span class="final-rank">${RANK_ICONS[i] || i + 1 + "."}</span>
      ${avatarHtml(p.avatarIndex)}
      <span class="final-name">${escHtml(p.name)}</span>
      <span class="final-score">${p.score} pts</span>
    `;
    finalScoreList.appendChild(li);
  });
}

// ─── Gallery ──────────────────────────────────────────────────────────────────
function renderGallery(screenshots) {
  galleryGrid.innerHTML = "";
  if (!screenshots || screenshots.length === 0) {
    galleryGrid.innerHTML =
      '<p style="color: var(--text-muted); padding: 20px;">No drawings captured.</p>';
    return;
  }

  screenshots.forEach(({ word, drawer, round, imageData }) => {
    const item = document.createElement("div");
    item.className = "gallery-item";

    const img = document.createElement("img");
    img.src = imageData;
    img.alt = word;

    const info = document.createElement("div");
    info.className = "gallery-item-info";
    info.innerHTML = `
      <div class="gallery-word">${escHtml(word)}</div>
      <div class="gallery-meta">by ${escHtml(drawer)} · Round ${round}</div>
    `;

    const dlBtn = document.createElement("button");
    dlBtn.className = "btn-download";
    dlBtn.textContent = "⬇ Download";
    dlBtn.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = imageData;
      a.download = `${word}-${drawer}.png`;
      a.click();
    });

    item.appendChild(img);
    item.appendChild(info);
    item.appendChild(dlBtn);
    galleryGrid.appendChild(item);
  });
}

socket.on("connect", () => {
  myId = socket.id;
});
