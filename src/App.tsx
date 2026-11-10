import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleHelp, Copy, Crown, Hand, Layers3, LogIn, Plus, RotateCcw, Spade, Trophy, Users, Wifi, WifiOff, X } from 'lucide-react';
import type { CardData, GameState, Meld, MeldSlot, Session } from './types';

const socket = io({ autoConnect: false, reconnection: true });
const KEY = 'rummy500-private-session';
const symbols: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', J: '★' };
const suitNames: Record<string, string> = { S: 'picas', H: 'corazones', D: 'diamantes', C: 'tréboles', J: 'comodín' };
const rankName = (r: number): string => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[r] || String(r);
const isRed = (s: string) => s === 'H' || s === 'D';
const suitOrder: Record<string, number> = { H: 0, D: 1, C: 2, S: 3, J: 4 };
const sortCards = (a: CardData, b: CardData) => suitOrder[a.suit] - suitOrder[b.suit] || a.rank - b.rank;

type Ack = { ok: boolean; error?: string; code?: string; playerId?: string; token?: string; name?: string };
type ActionData = Record<string, unknown>;
function emit(event: string, data: ActionData = {}): Promise<Ack> {
  return new Promise((resolve, reject) => {
    socket.timeout(9000).emit(event, data, (err: Error | null, result: Ack) => {
      if (err) reject(Error('No hubo respuesta del servidor. Revisá tu conexión.'));
      else resolve(result);
    });
  });
}

function CardFace({ card, selected = false, small = false, covered, onClick, muted = false }: {
  card: CardData; selected?: boolean; small?: boolean; covered?: { rank: number; suit: string }; onClick?: () => void; muted?: boolean;
}) {
  const joker = card.suit === 'J';
  return <button type="button" className={`playing-card ${isRed(card.suit) ? 'red' : ''} ${joker ? 'joker' : ''} ${small ? 'small' : ''} ${selected ? 'selected' : ''} ${onClick ? 'interactive' : 'static'} ${muted ? 'muted' : ''}`}
    disabled={!onClick} onClick={onClick} aria-pressed={selected} title={joker ? `Comodín${covered ? ` como ${rankName(covered.rank)} de ${suitNames[covered.suit]}` : ''}` : `${rankName(card.rank)} de ${suitNames[card.suit]}`}>
    <span className="card-corner">{joker ? 'JOK' : rankName(card.rank)}<span>{symbols[card.suit]}</span></span>
    <span className="card-center">{symbols[card.suit]}</span>
    {joker && covered && <span className="joker-as">{rankName(covered.rank)}{symbols[covered.suit]}</span>}
    {!small && <span className="card-bottom">{joker ? 'WILD' : symbols[card.suit]}</span>}
  </button>;
}

function Brand() {
  return <div className="brand"><div className="brand-mark"><Spade size={20} fill="currentColor" strokeWidth={1.5} /></div><span>rummy<span className="brand-numbers">500</span></span></div>;
}

function App() {
  const [connection, setConnection] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('sala') || '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedMeld, setSelectedMeld] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [showDiscard, setShowDiscard] = useState(true);

  useEffect(() => {
    const onConnect = () => {
      setConnection(true);
      const saved = sessionStorage.getItem(KEY);
      if (saved) {
        try {
          const parsed: Session = JSON.parse(saved);
          emit('resume', parsed).then(result => {
            if (!result.ok) {
              sessionStorage.removeItem(KEY);
              setSession(null); setGame(null);
              setError(result.error || 'No se pudo recuperar la partida.');
            } else {
              setSession(parsed);
              setError('');
            }
          }).catch(err => setError(String(err.message)));
        } catch { sessionStorage.removeItem(KEY); }
      }
    };
    const onDisconnect = () => setConnection(false);
    const onState = (state: GameState) => { setGame(state); setNotice(''); };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('connect_error', () => setError('No se pudo conectar al servidor.'));
    socket.connect();
    return () => {
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('state', onState);
      socket.off('connect_error'); socket.disconnect();
    };
  }, []);

  const saveSession = (response: Ack) => {
    const joined = {code: response.code!, playerId: response.playerId!, token: response.token!, name: response.name!};
    sessionStorage.setItem(KEY, JSON.stringify(joined));
    setSession(joined); setSelected([]); setSelectedMeld(null);
    setError('');
    window.history.replaceState({}, '', `?sala=${joined.code}`);
  };
  const request = useCallback(async (event: string, data: ActionData = {}, save = false) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await emit(event, data);
      if (!result.ok) setError(result.error || 'No se pudo completar la acción.');
      else if (save) saveSession(result);
      else setSelected([]);
      return result.ok;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión.');
      return false;
    } finally { setBusy(false); }
  }, []);
  const create = () => request('create', {name}, true);
  const join = () => request('join', {code: code.toUpperCase().trim(), name}, true);
  const quit = () => {
    sessionStorage.removeItem(KEY);
    window.location.href = window.location.pathname;
  };
  const copy = async () => {
    if (!game) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}/?sala=${game.code}`); setNotice('Enlace copiado. Compartilo con tus amigos.'); }
    catch { setError('No se pudo copiar automáticamente. Copiá el enlace de la barra de direcciones.'); }
  };
  const self = game?.players.find(p => p.id === session?.playerId);
  const myTurn = game?.status === 'playing' && game.turnId === session?.playerId;
  const canPlay = myTurn && game?.phase === 'play' && connection && !busy;
  const highlighted = game?.hand.find(c => selected.includes(c.id));
  const target = game?.melds.find(m => m.id === selectedMeld);
  const jokerToReplace = target?.cards.find(s => s.card.suit === 'J' && highlighted?.suit === s.asSuit && (highlighted.rank === s.asRank || (highlighted.rank === 1 && [1,14].includes(s.asRank))));
  const sortedHand = useMemo(() => [...(game?.hand || [])].sort(sortCards), [game?.hand]);
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(c => c !== id) : [...current, id]);
  const endTurn = () => selected.length === 1 && request('discard', {cardId: selected[0]});
  const playMeld = () => request('meld', {ids: selected});
  const layoff = (side: string = 'end') => request('layoff', {cardId: selected[0], meldId: selectedMeld, side});
  const replace = () => request('replace', {cardId: selected[0], meldId: selectedMeld, jokerId: jokerToReplace!.card.id});

  return <div className="app">
    <header className="site-header">
      <Brand />
      <div className="header-right"><div className={`online-pill ${connection ? '' : 'offline'}`}>{connection ? <Wifi size={14} /> : <WifiOff size={14} />}{connection ? 'Online' : 'Sin conexión'}</div>
        <button className="text-button" onClick={() => setRulesOpen(true)}><CircleHelp size={17} /> Reglas</button>
      </div>
    </header>
    {!session || !game ? (
      <main className="welcome">
        <div className="welcome-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> TU MESA DE CARTAS ONLINE</div>
          <h1>Una partida más.<br/><em>La última,</em> prometido.</h1>
          <p>El clásico Rummy 500 para compartir con tus amigos, desde donde estén. Sin descargas, sin cuentas y sin vueltas.</p>
          <div className="benefits"><span><Check size={16}/> Salas privadas</span><span><Check size={16}/> 2 a 4 jugadores</span><span><Check size={16}/> Gratis</span></div>
          <div className="hero-cards" aria-hidden="true"><div className="hero-card hc1">A <span>♥</span></div><div className="hero-card hc2">K <span>♠</span></div><div className="hero-card hc3">Q <span>♦</span></div></div>
        </div>
        <section className="join-panel">
          <div className="join-top"><div className="join-icon"><Users size={22}/></div><h2>Empezá a jugar</h2><p>Solo necesitás un nombre para entrar.</p></div>
          <label className="field-label" htmlFor="playerName">TU NOMBRE</label>
          <input id="playerName" className="field" maxLength={20} placeholder="¿Cómo te llamamos?" value={name} onChange={e => setName(e.target.value)} />
          <button className="primary-button full" disabled={!name.trim() || busy || !connection} onClick={create}><Plus size={18}/> Crear una sala nueva <ArrowRight size={18}/></button>
          <div className="or"><span/> o unirte a una existente <span/></div>
          <label className="field-label" htmlFor="roomCode">CÓDIGO DE LA SALA</label>
          <input id="roomCode" className="field code-field" maxLength={7} placeholder="Ej. B7H9P2K" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && name.trim() && code.length === 7) void join(); }} />
          <button className="secondary-button full" disabled={!name.trim() || code.length !== 7 || busy || !connection} onClick={join}><LogIn size={17}/> Entrar a la sala</button>
          {error && <div className="error-box" role="alert">{error}</div>}
          <p className="privacy-note">No necesitás correo ni contraseña. Las partidas no se guardan permanentemente.</p>
        </section>
      </main>
    ) : (
      <main className="game-layout">
        <div className="game-heading">
          <div><div className="eyebrow small-eyebrow">PARTIDA PRIVADA · {game.status === 'waiting' ? 'SALA DE ESPERA' : `RONDA ${game.round}`}</div><h1>{game.status === 'waiting' ? 'Todo listo para jugar.' : 'Mesa de juego'}</h1></div>
          <div className="room-actions"><div className="room-code"><span>CÓDIGO DE SALA</span><strong>{game.code}</strong></div><button className="icon-button copy-button" title="Copiar enlace de invitación" onClick={copy}><Copy size={19}/></button><button className="text-button exit" onClick={quit} title="Salir de la sala"><X size={17} /> Salir</button></div>
        </div>
        {notice && <div className="notice-box">{notice}</div>}
        {error && <div className="error-box" role="alert">{error}</div>}
        {game.status === 'waiting' ? (
          <div className="waiting">
            <section className="surface waiting-main"><div className="waiting-illustration"><Layers3 size={38}/></div><h2>Esperando a los demás</h2><p>Compartí el código o el enlace de la sala. Cuando estén todos, empieza la ronda.</p><button className="secondary-button" onClick={copy}><Copy size={16}/> Copiar invitación</button>
              <div className="waiting-players">{game.players.map((p,i) => <div className="waiting-player" key={p.id}><div className="avatar">{p.name.slice(0,2).toUpperCase()}</div><span>{p.name} {p.id === session.playerId ? '(vos)' : ''}</span>{p.id === game.hostId && <Crown size={15} className="gold"/>}<span className="participant-number">{i+1}/4</span></div>)}
                {game.players.length < 4 && <div className="waiting-placeholder"><Plus size={16}/> Lugar disponible</div>}</div>
              {game.hostId === session.playerId ? <button className="primary-button full" disabled={game.players.length < 2 || game.players.some(p => !p.connected) || busy} onClick={() => request('start')}><Spade size={17}/> Empezar partida <ArrowRight size={18}/></button> : <p className="subtle-center">Quien creó la sala inicia la partida.</p>}
              {game.players.length < 2 && <p className="subtle-center">Necesitás al menos 1 amigo más para jugar.</p>}
            </section>
            <aside className="surface waiting-side"><h3>Cómo se juega</h3><div className="rule-point"><span>01</span><p>Robá una carta del mazo o del descarte.</p></div><div className="rule-point"><span>02</span><p>Bajá tríos o escaleras y agregá cartas a la mesa.</p></div><div className="rule-point"><span>03</span><p>Descartá para terminar tu turno. Sumá puntos hasta llegar a 500.</p></div><button className="text-button" onClick={() => setRulesOpen(true)}>Ver reglas completas <ArrowRight size={15}/></button></aside>
          </div>
        ) : <>
          <section className="score-strip" aria-label="Puntajes de los jugadores">
            {game.players.map(p => <div key={p.id} className={`score-player ${p.id === game.turnId && game.status === 'playing' ? 'active-turn' : ''}`}><div className="score-avatar">{p.name.slice(0,2).toUpperCase()}</div><div className="score-name"><strong>{p.name}{p.id === session.playerId ? ' (vos)' : ''}</strong><small>{!p.connected ? 'Desconectado' : p.id === game.turnId && game.status === 'playing' ? 'Está jugando' : `${p.handCount} cartas`}</small></div><div className="score-value">{p.score}<span>pts</span></div></div>)}
          </section>
          {game.status === 'playing' ? <>
            <div className={`turn-banner ${myTurn ? 'mine' : ''}`}><span className="turn-dot"/>{myTurn ? (game.phase === 'draw' ? 'Es tu turno · Elegí de dónde robar' : 'Es tu turno · Podés bajar juegos o descartar') : `Es el turno de ${game.players.find(p => p.id === game.turnId)?.name}`}
              {game.mustUse && myTurn && <><span className="mandatory">Tenés que usar la carta levantada del descarte</span><button className="undo-link" disabled={busy} onClick={() => request('undoDraw')}>Deshacer robo</button></>}</div>
            <section className="table-surface">
              <div className="table-upper"><div className="table-label">SOBRE LA MESA</div><div className="table-stat"><Layers3 size={15}/> {game.melds.length} juegos bajados</div></div>
              <div className="meld-table">
                {game.melds.length === 0 && <div className="empty-meld"><div className="empty-symbol">♠</div><strong>Todavía no hay juegos</strong><span>El primero en bajar cartas estrena la mesa.</span></div>}
                {game.melds.map((m,index) => <MeldView key={m.id} meld={m} number={index+1} chosen={selectedMeld === m.id} players={game.players} onChoose={() => setSelectedMeld(prev => prev === m.id ? null : m.id)}/>)}
              </div>
              <div className="draw-row"><div className="deck-zone"><div className="section-title">MAZO <span>{game.deckCount} cartas</span></div><button className="card-back-stack" disabled={!myTurn || game.phase !== 'draw' || game.deckCount === 0 || busy} onClick={() => request('stock')} title="Robar una carta del mazo"><span>♠</span><span>ROBAR</span></button></div>
                <div className="discard-zone"><div className="section-title"><button className="toggle-discard" onClick={() => setShowDiscard(x => !x)}>DESCARTE ({game.discard.length}) <ChevronDown className={showDiscard ? '' : 'up'} size={15}/></button><span>Elegí cualquiera para levantarla y las de encima</span></div>
                  {showDiscard && <div className="discard-cards">{[...game.discard].map((card, index) => ({card,index})).reverse().map(({card,index}) => <div className="discard-choice" key={card.id}><CardFace card={card} small onClick={myTurn && game.phase === 'draw' && !busy ? () => request('take', {index}) : undefined}/>{myTurn && game.phase === 'draw' && <small>+{game.discard.length-index}</small>}</div>)}</div>}
                  {game.discard.length === 0 && <span className="empty-discard">No hay cartas descartadas.</span>}
                </div></div>
            </section>
            <section className="hand-section"><div className="hand-heading"><div><div className="eyebrow small-eyebrow">TUS CARTAS</div><h2>Tu mano <span>({game.hand.length})</span></h2></div><div className="hand-help">{myTurn && game.phase === 'play' ? 'Seleccioná cartas para hacer una jugada' : 'Las cartas se ordenan automáticamente'}</div></div>
              <div className="my-cards">{sortedHand.map(card => <CardFace key={card.id} card={card} selected={selected.includes(card.id)} muted={game.mustUse === card.id ? false : !!game.mustUse} onClick={canPlay ? () => toggle(card.id) : undefined}/>)}{sortedHand.length === 0 && <p>No te quedan cartas.</p>}</div>
              <div className="action-bar"><div className="action-description"><Hand size={20}/><div><strong>{selected.length ? `${selected.length} carta${selected.length !== 1 ? 's' : ''} seleccionada${selected.length !== 1 ? 's' : ''}` : 'Elegí tus cartas'}</strong><small>{target ? `Juego seleccionado: ${target.type === 'set' ? 'trío' : 'escalera'}` : 'Podés seleccionar un juego de la mesa para agregarle cartas'}</small></div></div>
                <div className="action-buttons">
                  <button className="secondary-button compact" disabled={!canPlay || selected.length < 3} onClick={playMeld}><Layers3 size={16}/> Bajar juego</button>
                  {highlighted?.suit === 'J' && target?.type === 'run' && selected.length === 1 ? <><button className="secondary-button compact" disabled={!canPlay} onClick={() => layoff('start')}>Agregar al inicio</button><button className="secondary-button compact" disabled={!canPlay} onClick={() => layoff('end')}>Agregar al final</button></> : <button className="secondary-button compact" disabled={!canPlay || selected.length !== 1 || !target} onClick={() => layoff()}><Plus size={16}/> Agregar al juego</button>}
                  {jokerToReplace && selected.length === 1 && <button className="secondary-button compact" disabled={!canPlay || !!game.mustUse} onClick={replace}><RotateCcw size={16}/> Cambiar comodín</button>}
                  <button className="primary-button compact" disabled={!canPlay || selected.length !== 1 || !!game.mustUse} onClick={endTurn}><ArrowDownToLine size={16}/> Descartar</button>
                </div>
              </div>
            </section>
            {game.deckCount === 0 && myTurn && game.phase === 'draw' && <div className="stock-ended"><p>Se terminó el mazo. Podés levantar del descarte o cerrar la ronda.</p><button className="secondary-button" onClick={() => request('endRound')}>Cerrar ronda</button></div>}
          </> : <section className="round-end surface"><div className="round-trophy"><Trophy size={30}/></div><div className="eyebrow small-eyebrow">{game.status === 'finished' ? 'PARTIDA TERMINADA' : `FIN DE LA RONDA ${game.round}`}</div><h2>{game.status === 'finished' ? `¡Ganó ${game.players.find(p => p.id === game.winnerId)?.name}!` : 'Así quedó la ronda'}</h2><p>{game.roundResult?.reason}</p><div className="score-table"><div className="score-table-head"><span>JUGADOR</span><span>BAJADAS</span><span>EN MANO</span><span>RONDA</span><span>TOTAL</span></div>{game.roundResult?.scores.map(row => <div key={row.id} className="score-table-line"><strong>{row.name}{row.id === session.playerId ? ' (vos)' : ''}</strong><span>+{row.earned}</span><span>-{row.penalty}</span><span className={row.delta >= 0 ? 'positive' : 'negative'}>{row.delta >= 0 ? '+' : ''}{row.delta}</span><strong>{row.total}</strong></div>)}</div>
            {game.status === 'roundOver' && (game.hostId === session.playerId ? <button className="primary-button" disabled={busy || game.players.some(p => !p.connected)} onClick={() => request('start')}>Jugar siguiente ronda <ArrowRight size={17}/></button> : <p>Esperando que el anfitrión inicie la siguiente ronda.</p>)}
            {game.status === 'finished' && <button className="secondary-button" onClick={quit}>Volver al inicio</button>}
          </section>}
          <div className="game-footnote">Última acción: {game.lastAction} · {self?.name} · Reglas de la sala: primer jugador en superar los 500 puntos con mayor puntaje.</div>
        </>}
      </main>
    )}
    <footer className="footer"><span>Rummy 500 · Hecho para jugar con amigos.</span><span>Sin cuentas ni datos personales almacenados.</span></footer>
    {rulesOpen && <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setRulesOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-label="Reglas del Rummy 500"><div className="modal-top"><h2>Reglas de esta versión</h2><button className="icon-button" onClick={() => setRulesOpen(false)} aria-label="Cerrar"><X size={20}/></button></div><div className="modal-body">
      <p>Esta es una variante concreta de Rummy 500, con comodines. Entre 2 y 4 jugadores: 13 cartas por jugador en duelos, 7 cartas en mesas de 3 o 4.</p>
      <h3>Tu turno</h3><p>Robás una carta del mazo o elegís una del descarte (levantás esa y todas las que están arriba). Si robás del descarte, tenés que jugar primero la carta que elegiste, en un juego nuevo o agregándola a otro. Después podés bajar más cartas y finalmente descartás una.</p>
      <h3>Juegos válidos</h3><p>Trío: 3 o 4 cartas del mismo número con diferentes palos. Escalera: 3 o más cartas consecutivas del mismo palo. El as puede ser bajo (A-2-3) o alto (Q-K-A), sin dar la vuelta. Podés usar comodines con al menos dos cartas naturales. También podés extender juegos de cualquier persona.</p>
      <h3>Comodines</h3><p>Podés reemplazar un comodín ya bajado con la carta exacta que representa. El comodín vuelve a tu mano y podés usarlo en otra jugada.</p>
      <h3>Puntaje</h3><p>Sumás el valor de cada carta que vos bajaste, incluso en juegos ajenos, y restás el valor de las que te quedaron en la mano. Los números valen su número; J, Q y K valen 10; ases y comodines, 15. El primer líder único que llega a 500 o más al cerrar una ronda gana.</p>
      <h3>Fin de ronda</h3><p>La ronda termina inmediatamente si alguien se queda sin cartas. Si se agota el mazo, quien debe robar puede cerrar la ronda o tomar del descarte. No se permite cantar “Rummy” sobre el descarte.</p>
      <p className="rule-warning">Las reglas del Rummy 500 varían según la mesa. Esta primera versión usa las reglas detalladas arriba; se pueden modificar en el código.</p>
    </div><button className="primary-button full" onClick={() => setRulesOpen(false)}>Entendido <Check size={16}/></button></section></div>}
  </div>;
}
function MeldView({meld, number, chosen, players, onChoose}: {meld: Meld; number: number; chosen: boolean; players: GameState['players']; onChoose: ()=>void}) {
  const originalOwner = players.find(p => p.id === meld.cards[0].by)?.name || 'Jugador';
  return <div className={`meld-group ${chosen ? 'chosen' : ''}`}><button className="meld-select" onClick={onChoose} aria-pressed={chosen}>
    <span>{meld.type === 'set' ? 'TRÍO' : 'ESCALERA'} {number}</span><span className="meld-owner">Inició {originalOwner}</span><span>{chosen ? '✓ Seleccionado' : 'Seleccionar +'}</span>
  </button><div className="meld-cards">{meld.cards.map((slot: MeldSlot) => <div className="meld-card-slot" key={slot.card.id}><CardFace small card={slot.card} covered={slot.card.suit === 'J' ? {rank: slot.asRank, suit: slot.asSuit} : undefined}/><span className="card-by" title={`Jugado por ${players.find(p => p.id === slot.by)?.name}`}>{players.find(p => p.id === slot.by)?.name.slice(0,8)}</span></div>)}</div>
  </div>;
}
export default App;
