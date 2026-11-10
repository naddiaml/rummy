import { randomInt, randomUUID } from 'node:crypto';

export const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = Array.from({ length: 13 }, (_, i) => i + 1);
const MAX_PLAYERS = 4;

export function newDeck() {
  return [
    ...SUITS.flatMap(suit => RANKS.map(rank => ({ id: `${suit}-${rank}`, suit, rank }))),
    { id: 'J-1', suit: 'J', rank: 0 },
    { id: 'J-2', suit: 'J', rank: 0 }
  ];
}

export function shuffle(cards) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function valueOf(card) {
  if (card.suit === 'J' || card.rank === 1) return 15;
  return card.rank >= 11 ? 10 : card.rank;
}

export function createRoom(code, host) {
  return {
    code, hostId: host.id, players: [host],
    status: 'waiting', round: 0, deck: [], discard: [], melds: [], pendingDraw: null,
    turnIndex: 0, phase: 'draw', mustUse: null,
    roundResult: null, winnerId: null, lastAction: 'Esperando jugadores…',
    updatedAt: Date.now()
  };
}

export function player(id, token, name, socketId) {
  return { id, token, name, socketId, connected: true, hand: [], score: 0 };
}

export function requireGame(room, actorId, phase = 'play') {
  if (room.status !== 'playing') throw Error('La partida no está en curso.');
  const current = room.players[room.turnIndex];
  if (current.id !== actorId) throw Error('No es tu turno.');
  if (!current.connected) throw Error('Reconectate para jugar.');
  if (phase && room.phase !== phase) {
    throw Error(phase === 'draw' ? 'Primero tenés que terminar el turno anterior.' : 'Primero robá una carta.');
  }
  return current;
}

function sameIds(actual, ids) {
  if (!Array.isArray(ids) || ids.length !== new Set(ids).size || ids.length === 0 || ids.length > 13 || !ids.every(id => typeof id === 'string')) {
    throw Error('Seleccioná cartas válidas y sin repetir.');
  }
  const cards = ids.map(id => actual.find(c => c.id === id));
  if (cards.some(c => !c)) throw Error('Una carta seleccionada no está en tu mano.');
  return cards;
}

function buildSet(cards) {
  const naturals = cards.filter(c => c.suit !== 'J');
  if (cards.length < 3 || cards.length > 4 || naturals.length < 2) return null;
  const rank = naturals[0].rank;
  if (!naturals.every(c => c.rank === rank)) return null;
  if (new Set(naturals.map(c => c.suit)).size !== naturals.length) return null;
  const remaining = SUITS.filter(s => !naturals.some(c => c.suit === s));
  if (cards.length - naturals.length > remaining.length) return null;
  const slots = [
    ...naturals.map(card => ({ card, asRank: rank, asSuit: card.suit })),
    ...cards.filter(c => c.suit === 'J').map((card, i) => ({ card, asRank: rank, asSuit: remaining[i] }))
  ];
  return { type: 'set', slots };
}

function buildRun(cards) {
  if (cards.length < 3 || cards.length > 13) return null;
  const naturals = cards.filter(c => c.suit !== 'J');
  if (naturals.length < 2 || !naturals.every(c => c.suit === naturals[0].suit)) return null;
  for (let start = 1; start + cards.length - 1 <= 14; start++) {
    const end = start + cards.length - 1;
    const options = naturals.map(c => c.rank === 1 ? [1, 14] : [c.rank]);
    const rankAssignment = [];
    let valid = true;
    for (const ranks of options) {
      const match = ranks.find(r => r >= start && r <= end && !rankAssignment.includes(r));
      if (match === undefined) { valid = false; break; }
      rankAssignment.push(match);
    }
    if (!valid) continue;
    const unused = Array.from({length: cards.length}, (_, i) => i + start).filter(r => !rankAssignment.includes(r));
    if (unused.length !== cards.length - naturals.length) continue;
    const slots = [
      ...naturals.map((card, i) => ({ card, asRank: rankAssignment[i], asSuit: card.suit })),
      ...cards.filter(c => c.suit === 'J').map((card, i) => ({card, asRank: unused[i], asSuit: naturals[0].suit}))
    ].sort((a, b) => a.asRank - b.asRank);
    return { type: 'run', slots };
  }
  return null;
}

export function validMeld(cards) {
  return buildSet(cards) || buildRun(cards);
}

function extension(meld, card, side = 'end') {
  if (meld.type === 'set') {
    if (meld.cards.length >= 4) return null;
    const rank = meld.cards[0].asRank;
    const suits = new Set(meld.cards.map(c => c.asSuit));
    let suit = card.suit;
    if (suit === 'J') suit = SUITS.find(s => !suits.has(s));
    if (!suit || suits.has(suit) || (card.suit !== 'J' && card.rank !== rank)) return null;
    return { card, asRank: rank, asSuit: suit };
  }
  const old = meld.cards;
  const min = Math.min(...old.map(c => c.asRank));
  const max = Math.max(...old.map(c => c.asRank));
  const suit = old[0].asSuit;
  if (card.suit !== 'J' && card.suit !== suit) return null;
  const options = card.suit === 'J' ? [side === 'start' ? min - 1 : max + 1] : (card.rank === 1 ? [1,14] : [card.rank]);
  const target = options.find(rank => (rank === min - 1 || rank === max + 1) && rank >= 1 && rank <= 14);
  return target === undefined ? null : { card, asRank: target, asSuit: suit };
}

export function startRound(room, actorId) {
  if (actorId !== room.hostId) throw Error('Solo quien creó la sala puede iniciar la ronda.');
  if (room.status !== 'waiting' && room.status !== 'roundOver') throw Error('No podés iniciar otra ronda ahora.');
  if (room.players.length < 2 || room.players.length > MAX_PLAYERS) throw Error('Se necesitan entre 2 y 4 jugadores.');
  if (room.players.some(p => !p.connected)) throw Error('Todos los jugadores deben estar conectados.');
  const cardsPerPlayer = room.players.length === 2 ? 13 : 7;
  const deck = shuffle(newDeck());
  for (const p of room.players) p.hand = deck.splice(0, cardsPerPlayer);
  room.discard = [deck.pop()];
  room.deck = deck;
  room.melds = [];
  room.round += 1;
  room.status = 'playing';
  room.turnIndex = (room.round - 1) % room.players.length;
  room.phase = 'draw';
  room.mustUse = null;
  room.pendingDraw = null;
  room.roundResult = null;
  room.lastAction = `Ronda ${room.round}: le toca a ${room.players[room.turnIndex].name}.`;
}

export function drawStock(room, actorId) {
  const p = requireGame(room, actorId, 'draw');
  if (!room.deck.length) throw Error('Se terminó el mazo. Podés tomar del descarte o cerrar la ronda.');
  p.hand.push(room.deck.pop());
  room.phase = 'play';
  room.mustUse = null;
  room.pendingDraw = null;
  room.lastAction = `${p.name} robó del mazo.`;
}

export function drawDiscard(room, actorId, index) {
  const p = requireGame(room, actorId, 'draw');
  if (!Number.isInteger(index) || index < 0 || index >= room.discard.length) throw Error('Elegí una carta del descarte.');
  const picked = room.discard[index];
  const acquired = room.discard.splice(index);
  p.hand.push(...acquired);
  room.mustUse = picked.id;
  room.pendingDraw = acquired.map(c => c.id);
  room.phase = 'play';
  room.lastAction = `${p.name} tomó ${acquired.length} carta(s) del descarte.`;
}

export function undoDiscardDraw(room, actorId) {
  const p = requireGame(room, actorId);
  if (!room.mustUse || !room.pendingDraw) throw Error('No hay un robo del descarte para deshacer.');
  const ids = new Set(room.pendingDraw);
  const collected = room.pendingDraw.map(id => p.hand.find(card => card.id === id));
  if (collected.some(card => !card)) throw Error('No se pudo deshacer el robo.');
  p.hand = p.hand.filter(card => !ids.has(card.id));
  room.discard.push(...collected);
  room.mustUse = null;
  room.pendingDraw = null;
  room.phase = 'draw';
  room.lastAction = `${p.name} devolvió las cartas al descarte.`;
}

function ensureMandatory(room, ids) {
  if (room.mustUse && !ids.includes(room.mustUse)) {
    throw Error('Antes de otra jugada, tenés que bajar la carta que tomaste del descarte.');
  }
}

function useCards(p, ids) {
  const set = new Set(ids);
  p.hand = p.hand.filter(c => !set.has(c.id));
}

function finishIfEmpty(room, p) {
  if (p.hand.length === 0) {
    closeRound(room, `${p.name} se quedó sin cartas.`);
    return true;
  }
  return false;
}

export function makeMeld(room, actorId, ids) {
  const p = requireGame(room, actorId);
  const cards = sameIds(p.hand, ids);
  ensureMandatory(room, ids);
  const result = validMeld(cards);
  if (!result) throw Error('No es un juego válido. Armá un trío o una escalera de al menos 3 cartas.');
  useCards(p, ids);
  room.melds.push({ id: randomUUID(), type: result.type, cards: result.slots.map(c => ({ ...c, by: p.id })) });
  room.mustUse = null;
  room.pendingDraw = null;
  room.lastAction = `${p.name} bajó un ${result.type === 'set' ? 'trío' : 'escalera'} de ${cards.length} cartas.`;
  finishIfEmpty(room, p);
}

export function layoff(room, actorId, cardId, meldId, side = 'end') {
  const p = requireGame(room, actorId);
  if (typeof cardId !== 'string' || typeof meldId !== 'string') throw Error('Seleccioná una carta y un juego de la mesa.');
  const [card] = sameIds(p.hand, [cardId]);
  ensureMandatory(room, [cardId]);
  const meld = room.melds.find(m => m.id === meldId);
  if (!meld) throw Error('El juego elegido no existe.');
  const slot = extension(meld, card, side);
  if (!slot) throw Error('Esa carta no puede agregarse a ese juego.');
  useCards(p, [cardId]);
  meld.cards.push({ ...slot, by: p.id });
  if (meld.type === 'run') meld.cards.sort((a, b) => a.asRank - b.asRank);
  room.mustUse = null;
  room.pendingDraw = null;
  room.lastAction = `${p.name} sumó una carta a un juego de la mesa.`;
  finishIfEmpty(room, p);
}

export function replaceJoker(room, actorId, cardId, meldId, jokerId) {
  const p = requireGame(room, actorId);
  if (room.mustUse) throw Error('Primero tenés que usar la carta que levantaste del descarte.');
  const [card] = sameIds(p.hand, [cardId]);
  if (card.suit === 'J') throw Error('Tenés que reemplazar el comodín por una carta real.');
  const meld = room.melds.find(m => m.id === meldId);
  if (!meld) throw Error('No se encontró ese juego.');
  const i = meld.cards.findIndex(s => s.card.id === jokerId && s.card.suit === 'J');
  if (i < 0) throw Error('No se encontró ese comodín.');
  const slot = meld.cards[i];
  if (card.suit !== slot.asSuit || (card.rank === 1 ? ![1, 14].includes(slot.asRank) : card.rank !== slot.asRank)) {
    throw Error('Esa carta no reemplaza el valor representado por el comodín.');
  }
  useCards(p, [cardId]);
  p.hand.push(slot.card);
  meld.cards[i] = { card, asRank: slot.asRank, asSuit: slot.asSuit, by: p.id };
  room.lastAction = `${p.name} recuperó un comodín.`;
}

export function discardCard(room, actorId, cardId) {
  const p = requireGame(room, actorId);
  if (room.mustUse) throw Error('Primero bajá la carta que tomaste del descarte.');
  const [card] = sameIds(p.hand, [cardId]);
  useCards(p, [cardId]);
  room.discard.push(card);
  room.lastAction = `${p.name} descartó una carta.`;
  if (finishIfEmpty(room, p)) return;
  room.phase = 'draw';
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
}

export function closeEmptyDeck(room, actorId) {
  requireGame(room, actorId, 'draw');
  if (room.deck.length) throw Error('Todavía quedan cartas en el mazo.');
  closeRound(room, 'Se agotó el mazo y terminó la ronda.');
}

export function closeRound(room, reason) {
  const roundScores = room.players.map(p => {
    const pointsOnTable = room.melds.flatMap(m => m.cards).filter(s => s.by === p.id).reduce((sum, s) => sum + valueOf(s.card), 0);
    const pointsOnHand = p.hand.reduce((sum, card) => sum + valueOf(card), 0);
    const delta = pointsOnTable - pointsOnHand;
    p.score += delta;
    return { id: p.id, name: p.name, earned: pointsOnTable, penalty: pointsOnHand, delta, total: p.score };
  });
  const max = Math.max(...room.players.map(p => p.score));
  const leaders = room.players.filter(p => p.score === max);
  room.winnerId = max >= 500 && leaders.length === 1 ? leaders[0].id : null;
  room.status = room.winnerId ? 'finished' : 'roundOver';
  room.roundResult = { reason, scores: roundScores };
  room.lastAction = reason;
  room.phase = 'draw';
  room.mustUse = null;
  room.pendingDraw = null;
}

export function viewerState(room, playerId) {
  const viewer = room.players.find(p => p.id === playerId);
  if (!viewer) throw Error('Jugador desconocido.');
  return {
    code: room.code, hostId: room.hostId, status: room.status, round: room.round,
    players: room.players.map(p => ({id: p.id, name: p.name, score: p.score, connected: p.connected, handCount: p.hand.length})),
    turnId: room.players[room.turnIndex]?.id ?? null,
    phase: room.phase, mustUse: room.mustUse,
    hand: viewer.hand,
    deckCount: room.deck.length,
    discard: room.discard,
    melds: room.melds,
    roundResult: room.roundResult,
    winnerId: room.winnerId,
    lastAction: room.lastAction
  };
}
