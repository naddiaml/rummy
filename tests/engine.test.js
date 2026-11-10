import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newDeck, valueOf, validMeld, createRoom, player, startRound,
  makeMeld, layoff, replaceJoker, drawStock, drawDiscard, discardCard,
  closeRound, undoDiscardDraw, viewerState
} from '../server/game.js';

const card = (suit, rank) => ({ id: `${suit}-${rank}`, suit, rank });
const joke = (n=1) => ({ id: `J-${n}`, suit: 'J', rank: 0 });
const setup = () => {
  const p1 = player('p1', 'token1', 'Ana', 'socket1');
  const p2 = player('p2', 'token2', 'Beto', 'socket2');
  const room = createRoom('TEST123', p1);
  room.players.push(p2);
  startRound(room, p1.id);
  return {room,p1,p2};
};

test('mazo tiene 54 cartas distintas y ases valen 15', () => {
  const d = newDeck();
  assert.equal(d.length, 54);
  assert.equal(new Set(d.map(c => c.id)).size, 54);
  assert.equal(valueOf(card('H', 1)), 15);
  assert.equal(valueOf(card('H', 12)), 10);
  assert.equal(valueOf(card('D', 8)), 8);
  assert.equal(valueOf(joke()), 15);
});

test('valida tríos sin palos repetidos y con comodines', () => {
  const meld = validMeld([card('H',7),card('D',7),joke()]);
  assert.equal(meld.type, 'set');
  assert.equal(meld.slots[2].asRank, 7);
  assert.equal(validMeld([card('H',7),card('H',7),card('D',7)]), null);
  assert.equal(validMeld([card('H',7),joke(),joke(2)]), null);
});

test('valida escaleras bajas y altas con as y rechaza vueltas', () => {
  let m = validMeld([card('H',1),card('H',2),card('H',3)]);
  assert.equal(m.type, 'run');
  assert.deepEqual(m.slots.map(c => c.asRank), [1,2,3]);
  m = validMeld([card('S',12),card('S',13),card('S',1)]);
  assert.deepEqual(m.slots.map(c => c.asRank), [12,13,14]);
  assert.equal(validMeld([card('S',13),card('S',1),card('S',2)]), null);
  m = validMeld([card('D',9),joke(),card('D',11)]);
  assert.deepEqual(m.slots.map(c => c.asRank), [9,10,11]);
});

test('inicia dos jugadores con 13 cartas y oculta la mano rival', () => {
  const {room,p1,p2} = setup();
  assert.equal(p1.hand.length, 13);
  assert.equal(p2.hand.length, 13);
  assert.equal(room.deck.length, 27);
  assert.equal(room.discard.length, 1);
  const visible = viewerState(room, 'p1');
  assert.equal(visible.hand.length, 13);
  assert.equal(visible.players[1].handCount, 13);
  assert.equal('token' in visible.players[1], false);
  assert.equal('hand' in visible.players[1], false);
});

test('no permite bajar antes de robar; un descarte tomado debe jugarse', () => {
  const {room,p1} = setup();
  room.discard = [card('H',3),card('H',4)];
  p1.hand = [card('H',5),card('H',6),card('D',11),card('S',9)];
  assert.throws(() => makeMeld(room,'p1',['H-3','H-5','H-6']));
  drawDiscard(room,'p1',0);
  assert.equal(room.mustUse, 'H-3');
  assert.equal(room.discard.length,0);
  assert.throws(() => discardCard(room,'p1','D-11'));
  assert.throws(() => makeMeld(room,'p1',['H-4','H-5','H-6']));
  makeMeld(room,'p1',['H-3','H-4','H-5','H-6']);
  assert.equal(room.mustUse, null);
  discardCard(room,'p1','D-11');
  assert.equal(room.turnIndex,1);
});

test('permite agregar a juego rival y suma puntos al jugador que agregó', () => {
  const {room,p1,p2} = setup();
  room.phase = 'play';
  p1.hand = [card('D',7),card('H',7),card('S',7),card('C',8),card('C',9)];
  makeMeld(room,'p1',['D-7','H-7','S-7']);
  discardCard(room,'p1','C-8');
  drawStock(room,'p2');
  p2.hand = [card('C',7),card('D',5)];
  layoff(room,'p2','C-7',room.melds[0].id);
  assert.equal(room.status,'playing');
  closeRound(room,'Prueba');
  assert.equal(room.roundResult.scores.find(s => s.id === 'p1').earned,21);
  assert.equal(room.roundResult.scores.find(s => s.id === 'p2').earned,7);
});

test('reemplazar comodín mueve crédito y devuelve joker a la mano', () => {
  const {room,p1} = setup();
  room.phase = 'play';
  p1.hand = [card('H',7),card('D',7),joke(),card('C',4)];
  makeMeld(room,'p1',['H-7','D-7','J-1']);
  const meld = room.melds[0];
  const missingSuit = meld.cards.find(c => c.card.id === 'J-1').asSuit;
  p1.hand.push(card(missingSuit,7));
  replaceJoker(room,'p1',`${missingSuit}-7`,meld.id,'J-1');
  assert.ok(p1.hand.some(c => c.id === 'J-1'));
  assert.equal(meld.cards.filter(c => c.card.suit === 'J').length,0);
});

test('al quedarse sin cartas calcula puntos con negativos y finaliza inmediatamente', () => {
  const {room,p1,p2} = setup();
  room.phase = 'play';
  p1.hand = [card('H',3),card('H',4),card('H',5)];
  p2.hand = [card('S',1),card('D',9)];
  makeMeld(room,'p1',['H-3','H-4','H-5']);
  assert.equal(room.status,'roundOver');
  assert.equal(room.roundResult.scores[0].delta,12);
  assert.equal(room.roundResult.scores[1].delta,-24);
});

test('deshacer robo del descarte restaura el orden original y permite elegir otra fuente', () => {
  const {room,p1} = setup();
  const handBefore = p1.hand.map(c => c.id);
  room.discard = room.deck.splice(0, 3);
  const discardBefore = room.discard.map(c => c.id);
  drawDiscard(room, 'p1', 1);
  assert.equal(room.discard.length, 1);
  undoDiscardDraw(room, 'p1');
  assert.deepEqual(room.discard.map(c => c.id), discardBefore);
  assert.deepEqual(p1.hand.map(c => c.id), handBefore);
  assert.equal(room.phase, 'draw');
  drawStock(room, 'p1');
  assert.equal(p1.hand.length,14);
});

test('cuando alcanza 500 puntos y es líder único termina la partida', () => {
  const {room,p1,p2} = setup();
  p1.score = 490;
  p2.score = 3;
  p1.hand = [];
  p2.hand = [card('D',3)];
  room.melds = [{ id: 'm1', type:'set', cards: [card('H',7),card('C',7),card('S',7)].map(card => ({card,asRank:7,asSuit:card.suit,by:'p1'})) }];
  closeRound(room, 'ronda de prueba');
  assert.equal(room.status,'finished');
  assert.equal(room.winnerId,'p1');
  assert.equal(room.roundResult.scores[0].total, 511);
  assert.equal(room.roundResult.scores[1].total, 0);
});
