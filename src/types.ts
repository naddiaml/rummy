export type Suit = 'S' | 'H' | 'D' | 'C' | 'J';
export type CardData = { id: string; suit: Suit; rank: number };
export type PlayerData = { id: string; name: string; score: number; connected: boolean; handCount: number };
export type MeldSlot = { card: CardData; asRank: number; asSuit: Suit; by: string };
export type Meld = { id: string; type: 'set' | 'run'; cards: MeldSlot[] };
export type RoundScore = { id: string; name: string; earned: number; penalty: number; delta: number; total: number };
export type GameState = {
  code: string; hostId: string; status: 'waiting' | 'playing' | 'roundOver' | 'finished';
  round: number; players: PlayerData[]; turnId: string | null; phase: 'draw' | 'play';
  mustUse: string | null; hand: CardData[]; deckCount: number; discard: CardData[];
  melds: Meld[]; roundResult: { reason: string; scores: RoundScore[] } | null;
  winnerId: string | null; lastAction: string;
};
export type Session = { code: string; playerId: string; token: string; name: string };
