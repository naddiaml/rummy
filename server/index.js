import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createRoom, player, startRound, drawStock, drawDiscard, makeMeld,
  layoff, replaceJoker, discardCard, closeEmptyDeck, undoDiscardDraw, viewerState
} from './game.js';

const PORT = Number(process.env.PORT || 3001);
const MAX_ROOMS = 200;
const rooms = new Map();
const app = express();
const server = createServer(app);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' wss:; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  }
  next();
});
app.get('/health', (_req, res) => res.json({ ok: true }));

const io = new Server(server, {
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 8_000,
  pingTimeout: 25_000,
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (!origin) return callback(null, true);
    try { callback(null, new URL(origin).host === req.headers.host); }
    catch { callback(null, false); }
  }
});

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let code;
  do { code = Array.from({ length: 7 }, () => alphabet[randomInt(alphabet.length)]).join(''); }
  while (rooms.has(code));
  return code;
}
function safeName(raw) {
  if (typeof raw !== 'string') throw Error('Ingresá un nombre para jugar.');
  const name = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  if (!name || name.length > 20 || name.includes('<') || name.includes('>')) throw Error('Tu nombre debe tener entre 1 y 20 caracteres.');
  return name;
}
function updateRoom(room) {
  room.updatedAt = Date.now();
  for (const p of room.players) {
    if (p.socketId && p.connected) io.to(p.socketId).emit('state', viewerState(room, p.id));
  }
}
function ackSafe(done, callback) {
  const reply = typeof done === 'function' ? done : () => {};
  try { const data = callback(); reply({ ok: true, ...data }); }
  catch (err) { reply({ ok: false, error: err instanceof Error ? err.message : 'Error inesperado.' }); }
}
function activate(socket, room, p) {
  const prior = p.socketId;
  if (prior && prior !== socket.id) {
    const oldSocket = io.sockets.sockets.get(prior);
    if (oldSocket) { oldSocket.data.code = null; oldSocket.data.playerId = null; oldSocket.disconnect(true); }
  }
  socket.data.code = room.code;
  socket.data.playerId = p.id;
  p.socketId = socket.id;
  p.connected = true;
  socket.join(room.code);
}
function authenticated(socket) {
  const room = rooms.get(socket.data.code);
  if (!room) throw Error('Esta sala ya no existe.');
  const p = room.players.find(p => p.id === socket.data.playerId && p.socketId === socket.id);
  if (!p) throw Error('Volvé a entrar a la sala.');
  return { room, p };
}

io.on('connection', socket => {
  // Limita eventos de cada conexión; protege contra llamadas repetitivas accidentales o maliciosas.
  let windowStart = Date.now();
  let count = 0;
  socket.use((_packet, next) => {
    if (Date.now() - windowStart > 10_000) { count = 0; windowStart = Date.now(); }
    count += 1;
    next(count <= 35 ? undefined : new Error('Demasiadas acciones seguidas.'));
  });
  socket.on('create', (data, done) => ackSafe(done, () => {
    if (socket.data.playerId) throw Error('Ya estás jugando en una sala.');
    if (rooms.size >= MAX_ROOMS) throw Error('Hay demasiadas salas abiertas. Probá más tarde.');
    const name = safeName(data?.name);
    const p = player(randomUUID(), randomBytes(32).toString('hex'), name, socket.id);
    const room = createRoom(newCode(), p);
    rooms.set(room.code, room);
    activate(socket, room, p);
    queueMicrotask(() => updateRoom(room));
    return { code: room.code, playerId: p.id, token: p.token, name: p.name };
  }));
  socket.on('join', (data, done) => ackSafe(done, () => {
    if (socket.data.playerId) throw Error('Ya estás jugando en una sala.');
    const code = String(data?.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw Error('No encontramos esa sala. Revisá el código.');
    if (room.status !== 'waiting') throw Error('La partida ya empezó. Solo pueden volver quienes ya estaban jugando.');
    if (room.players.length >= 4) throw Error('La sala está completa (máximo 4 jugadores).');
    const name = safeName(data?.name);
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) throw Error('Ya hay alguien usando ese nombre en la sala.');
    const p = player(randomUUID(), randomBytes(32).toString('hex'), name, socket.id);
    room.players.push(p);
    activate(socket, room, p);
    room.lastAction = `${name} entró a la sala.`;
    queueMicrotask(() => updateRoom(room));
    return {code, playerId: p.id, token: p.token, name};
  }));
  socket.on('resume', (data, done) => ackSafe(done, () => {
    if (socket.data.playerId) throw Error('Ya estás conectado a una sala.');
    const room = rooms.get(data?.code);
    if (!room) throw Error('La sala se cerró o el servidor se reinició.');
    const p = room.players.find(p => p.id === data?.playerId);
    if (!p || typeof data?.token !== 'string' || p.token !== data.token) throw Error('No se pudo recuperar tu lugar en esta sala.');
    activate(socket, room, p);
    queueMicrotask(() => updateRoom(room));
    return {code: room.code, playerId: p.id, token: p.token, name: p.name};
  }));
  const actions = {
    'start': ({room,p}) => startRound(room,p.id),
    'stock': ({room,p}) => drawStock(room,p.id),
    'undoDraw': ({room,p}) => undoDiscardDraw(room,p.id),
    'take': ({room,p}, data) => drawDiscard(room,p.id,data?.index),
    'meld': ({room,p}, data) => makeMeld(room,p.id,data?.ids),
    'layoff': ({room,p}, data) => layoff(room,p.id,data?.cardId,data?.meldId,data?.side),
    'replace': ({room,p}, data) => replaceJoker(room,p.id,data?.cardId,data?.meldId,data?.jokerId),
    'discard': ({room,p}, data) => discardCard(room,p.id,data?.cardId),
    'endRound': ({room,p}) => closeEmptyDeck(room,p.id)
  };
  for (const [event, action] of Object.entries(actions)) {
    socket.on(event, (data, done) => ackSafe(done, () => {
      const context = authenticated(socket);
      action(context, data);
      updateRoom(context.room);
      return {};
    }));
  }
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (!room) return;
    const p = room.players.find(p => p.id === socket.data.playerId);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    if (room.hostId === p.id) {
      const nextHost = room.players.find(other => other.connected);
      if (nextHost) room.hostId = nextHost.id;
    }
    updateRoom(room);
  });
});

// Eliminar salas sin jugadores conectados, sin almacenar historial personal.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.every(p => !p.connected) && now - room.updatedAt > 60 * 60 * 1000) rooms.delete(code);
  }
}, 5 * 60_000).unref();

if (process.env.NODE_ENV === 'production') {
  const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')));
}
server.listen(PORT, '0.0.0.0', () => console.log(`Rummy 500 en http://localhost:${PORT}`));
