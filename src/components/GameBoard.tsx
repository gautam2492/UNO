import React, { useState, useEffect } from 'react';
import { Card } from './Card';
import type { CardData } from './Card';
import { useSound } from '../hooks/useSound';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  isHost: boolean;
  isBot?: boolean;
  cardCount?: number;
  cards?: CardData[];
}

interface GameState {
  discardPile: CardData[];
  activeColor: 'red' | 'green' | 'blue' | 'yellow' | 'wild';
  currentTurn: number;
  direction: number;
  drawStack: number;
  unoCalls: Record<string, boolean>;
  unoPendingPenalty: Record<string, boolean>;
  hasDrawn: boolean;
  drawnCardPlayable: CardData | null;
  winner: string | null;
  deckCount: number;
  players: { id: string; name: string }[];
  timerSeconds?: number;
  pendingChallenge?: {
    challengerId: string;
    playerId: string;
    drawAmount: number;
    activeColorBeforePlay: string;
    cardId: string;
    chosenColor: string;
  } | null;
  pendingHandSwap?: {
    playerId: string;
  } | null;
}

interface GameBoardProps {
  gameState: GameState;
  players: Player[];
  currentUserSocketId: string;
  drawnCardInfo: { card: CardData; isPlayable: boolean } | null;
  onPlayCard: (cardId: string, chosenColor?: string) => void;
  onDrawCard: () => void;
  onPassTurn: () => void;
  onPlayDrawnCard: (chosenColor?: string) => void;
  onDeclareUno: () => void;
  onCatchUno: (targetPlayerId: string) => void;
  onResetDrawnCard: () => void;
  activeEmojis?: { id: string; playerId: string; emoji: string }[];
  voiceMutedStates?: Record<string, boolean>;
  voiceSpeakingStates?: Record<string, boolean>;
  colorblindMode?: boolean;
  onResolveChallenge?: (action: 'challenge' | 'accept') => void;
  onSwapHands?: (targetPlayerId: string) => void;
  locallyMuted?: Record<string, boolean>;
  onToggleMutePeer?: (peerId: string) => void;
}

export const GameBoard: React.FC<GameBoardProps> = ({
  gameState,
  players,
  currentUserSocketId,
  drawnCardInfo,
  onPlayCard,
  onDrawCard,
  onPassTurn,
  onPlayDrawnCard,
  onDeclareUno,
  onCatchUno,
  onResetDrawnCard,
  activeEmojis = [],
  voiceMutedStates = {},
  voiceSpeakingStates = {},
  colorblindMode = false,
  onResolveChallenge,
  onSwapHands,
  locallyMuted = {},
  onToggleMutePeer,
}) => {
  const { playCardSound, playDrawSound, playUnoSound, playErrorSound } = useSound();

  const [selectedWildCard, setSelectedWildCard] = useState<CardData | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isDrawnPlayableCardWild, setIsDrawnPlayableCardWild] = useState(false);

  // Play card sound on top card changes
  const topCardId = gameState.discardPile[gameState.discardPile.length - 1]?.id;
  useEffect(() => {
    if (topCardId) {
      playCardSound();
    }
  }, [topCardId]);

  // Play UNO sound on call count updates
  const unoCallsCount = Object.keys(gameState.unoCalls).length;
  useEffect(() => {
    if (unoCallsCount > 0) {
      playUnoSound();
    }
  }, [unoCallsCount]);

  // Find user details
  const me = players.find(p => p.id === currentUserSocketId);
  const myCards = me?.cards || [];
  const isMyTurn = gameState.players[gameState.currentTurn]?.id === currentUserSocketId;

  // Rearrange seating clockwise from user
  const myIndex = players.findIndex(p => p.id === currentUserSocketId);
  const reordered = [...players.slice(myIndex), ...players.slice(0, myIndex)];
  const opponents = reordered.slice(1);

  const handleCardClick = (card: CardData) => {
    if (!isMyTurn) {
      playErrorSound();
      return;
    }

    if (card.color === 'wild') {
      setSelectedWildCard(card);
      setIsDrawnPlayableCardWild(false);
      setShowColorPicker(true);
    } else {
      onPlayCard(card.id);
    }
  };

  const handleSelectColor = (color: string) => {
    setShowColorPicker(false);
    if (isDrawnPlayableCardWild) {
      onPlayDrawnCard(color);
      setIsDrawnPlayableCardWild(false);
    } else if (selectedWildCard) {
      onPlayCard(selectedWildCard.id, color);
      setSelectedWildCard(null);
    }
  };

  const handleDrawClick = () => {
    if (!isMyTurn || gameState.hasDrawn) {
      playErrorSound();
      return;
    }
    playDrawSound();
    onDrawCard();
  };

  const handlePlayDrawnClick = () => {
    if (!gameState.drawnCardPlayable) return;
    if (gameState.drawnCardPlayable.color === 'wild') {
      setIsDrawnPlayableCardWild(true);
      setShowColorPicker(true);
    } else {
      onPlayDrawnCard();
    }
  };

  const handlePassClick = () => {
    onPassTurn();
  };

  const isCardPlayable = (card: CardData) => {
    if (gameState.drawStack > 0) {
      return card.type === 'draw_2' || card.type === 'wild_draw';
    }
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];
    return card.color === 'wild' || card.color === gameState.activeColor || card.value === topCard.value;
  };

  // User card fan alignments
  const getFannedCardStyle = (index: number, total: number) => {
    if (total <= 1) return {};
    const maxSpread = Math.min(60, total * 6);
    const angleStep = maxSpread / (total - 1);
    const rotation = (index - (total - 1) / 2) * angleStep;

    const maxTranslation = Math.min(300, total * 25);
    const xStep = maxTranslation / (total - 1);
    const translateX = (index - (total - 1) / 2) * xStep;

    const parabolicY = Math.pow(Math.abs(index - (total - 1) / 2), 2) * (18 / Math.pow((total - 1) / 2, 2) || 0);
    const translateY = parabolicY;

    return {
      transform: `translateX(${translateX}px) translateY(${translateY}px) rotate(${rotation}deg)`,
      zIndex: index + 1,
      '--hover-rotation': `${rotation}deg`,
    } as React.CSSProperties;
  };

  const topCard = gameState.discardPile[gameState.discardPile.length - 1];

  return (
    <div className="arena">
      {/* Top Bar Game Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', zIndex: 20, width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>
            Active Color: <span style={{ color: `var(--color-${gameState.activeColor})`, textTransform: 'uppercase' }}>{gameState.activeColor}</span>
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Deck remaining: {gameState.deckCount} cards
          </p>
        </div>

        {/* Turn Direction indicator */}
        <div className="direction-indicator">
          <span>Direction:</span>
          <span className={`direction-arrows ${gameState.direction === 1 ? 'rotate-clockwise' : 'rotate-counter'}`}>
            {gameState.direction === 1 ? '↻' : '↺'}
          </span>
          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
            {gameState.direction === 1 ? 'Clockwise' : 'Counter-Clockwise'}
          </span>
        </div>
      </div>

      {/* Opponents circular/arc seating container */}
      <div className="opponents-container">
        {opponents.map((opponent, idx) => {
          const total = opponents.length;
          // Distribute players in an arc along the top half (180 to 0 degrees)
          const ratio = total > 1 ? idx / (total - 1) : 0.5;
          const angle = Math.PI - ratio * Math.PI;
          const leftPercent = 50 + 43 * Math.cos(angle);
          const topPercent = 45 - 38 * Math.sin(angle);

          const isOpponentTurn = gameState.players[gameState.currentTurn]?.id === opponent.id;
          const isVulnerable = opponent.cardCount === 1 && !gameState.unoCalls[opponent.id];

          return (
            <div
              key={opponent.id}
              className="opponent-seat"
              style={{
                position: 'absolute',
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: 50
              }}
            >
              {/* Floating Emojis */}
              {activeEmojis.filter(e => e.playerId === opponent.id).map(e => (
                <div
                  key={e.id}
                  className="floating-emoji"
                  style={{
                    position: 'absolute',
                    top: '-55px',
                    fontSize: '2.4rem',
                    animation: 'float-up-fade 2s forwards',
                    pointerEvents: 'none',
                    zIndex: 100
                  }}
                >
                  {e.emoji}
                </div>
              ))}

              <div className={`opponent-avatar ${isOpponentTurn ? 'active-turn' : ''}`}>
                {opponent.name.charAt(0).toUpperCase()}
                <span className="opponent-cards-count">{opponent.cardCount || 0}</span>

                {/* Turn Timer Countdown */}
                {isOpponentTurn && gameState.timerSeconds !== undefined && (
                  <div style={{
                    position: 'absolute',
                    top: '-6px',
                    left: '-6px',
                    background: 'var(--color-blue)',
                    color: 'white',
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    fontSize: '0.65rem',
                    fontWeight: 'bold',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid white',
                    boxShadow: '0 0 8px var(--color-blue)',
                    zIndex: 10
                  }}>
                    {gameState.timerSeconds}
                  </div>
                )}

                {/* Voice mute status */}
                {voiceMutedStates[opponent.id] && (
                  <div style={{
                    position: 'absolute',
                    bottom: '-6px',
                    left: '-6px',
                    background: '#ea4335',
                    color: 'white',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.65rem',
                    border: '1px solid white',
                    zIndex: 10
                  }}>
                    🔇
                  </div>
                )}

                {/* Voice speaking indicator */}
                {!voiceMutedStates[opponent.id] && voiceSpeakingStates[opponent.id] && (
                  <div style={{
                    position: 'absolute',
                    bottom: '-6px',
                    left: '-6px',
                    background: '#34a853',
                    color: 'white',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.65rem',
                    border: '1px solid white',
                    zIndex: 10,
                    animation: 'pulse-stack 1s infinite'
                  }}>
                    🎙️
                  </div>
                )}

                {/* Clickable Local Peer Mute overlays */}
                {!opponent.isBot && (
                  <button
                    onClick={() => onToggleMutePeer?.(opponent.id)}
                    style={{
                      position: 'absolute',
                      bottom: '-6px',
                      right: '-6px',
                      background: locallyMuted[opponent.id] ? '#ea4335' : 'rgba(0,0,0,0.5)',
                      color: 'white',
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.6rem',
                      border: '1px solid white',
                      cursor: 'pointer',
                      zIndex: 10
                    }}
                    title={locallyMuted[opponent.id] ? "Unmute player locally" : "Mute player locally"}
                  >
                    {locallyMuted[opponent.id] ? '🔇' : '🔊'}
                  </button>
                )}

                {/* Catch button */}
                {isVulnerable && (
                  <button
                    onClick={() => onCatchUno(opponent.id)}
                    className="catch-btn pulse-glow"
                    style={{
                      position: 'absolute',
                      top: '-15px',
                      right: '-15px',
                      padding: '4px 8px',
                      fontSize: '0.7rem',
                      borderRadius: '10px',
                      zIndex: 10
                    }}
                  >
                    🚨 Catch!
                  </button>
                )}
              </div>
              <span className="opponent-name" style={{ maxWidth: '75px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {opponent.name}
              </span>
            </div>
          );
        })}
      </div>

      {/* Game table Felt felt layout */}
      <div className="table-center">
        <div className="felt-surface">
          <div className="pile-container">
            {/* Draw Pile */}
            <div className="draw-pile" onClick={handleDrawClick}>
              {gameState.deckCount > 1 && (
                <div className="draw-pile-shadow-card">
                  <Card isBack={true} size="md" />
                </div>
              )}
              <div className="draw-pile-top-card">
                <Card isBack={true} size="md" />
              </div>
            </div>

            {/* Discard Pile */}
            <div className="discard-pile">
              {gameState.drawStack > 0 && (
                <div className="draw-stack-badge">
                  Stack Penalty: +{gameState.drawStack}
                </div>
              )}
              {topCard && (
                <Card card={topCard} isPlayable={false} size="md" colorblindMode={colorblindMode} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Area: User controls & hands */}
      <div className="user-hand-panel">
        {/* Floating Emojis for User */}
        {activeEmojis.filter(e => e.playerId === currentUserSocketId).map(e => (
          <div
            key={e.id}
            className="floating-emoji"
            style={{
              position: 'absolute',
              top: '-40px',
              fontSize: '3rem',
              animation: 'float-up-fade 2s forwards',
              pointerEvents: 'none',
              zIndex: 100
            }}
          >
            {e.emoji}
          </div>
        ))}

        {/* Turn alerts */}
        {isMyTurn && (
          <div
            style={{
              padding: '6px 16px',
              borderRadius: '20px',
              background: 'rgba(0, 180, 216, 0.15)',
              border: '1px solid rgba(0, 180, 216, 0.3)',
              color: '#90e0ef',
              fontWeight: 800,
              fontSize: '0.9rem',
              animation: 'pulse-stack 2s infinite',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <span>👉 It is your turn! Play a card or draw.</span>
            {gameState.timerSeconds !== undefined && (
              <span style={{
                background: 'var(--color-blue)',
                color: 'white',
                padding: '2px 8px',
                borderRadius: '10px',
                fontSize: '0.75rem',
                fontWeight: 900,
                boxShadow: '0 0 10px rgba(0, 180, 216, 0.6)'
              }}>
                ⏱️ {gameState.timerSeconds}s
              </span>
            )}
          </div>
        )}

        {/* Fanned Card list */}
        <div className="hand-scroll-container">
          {myCards.map((card, idx) => {
            const playable = isCardPlayable(card) && !gameState.hasDrawn;
            const cardStyle = getFannedCardStyle(idx, myCards.length);
            return (
              <div key={card.id} className="hand-card-wrapper" style={cardStyle}>
                <Card
                  card={card}
                  isPlayable={playable}
                  onClick={() => handleCardClick(card)}
                  size="md"
                  colorblindMode={colorblindMode}
                />
              </div>
            );
          })}
        </div>

        {/* Action Controls */}
        <div className="action-controls">
          {/* Declaring UNO when cards == 2 before playing */}
          {myCards.length <= 2 && !gameState.unoCalls[currentUserSocketId] && (
            <button onClick={onDeclareUno} className="btn uno-btn">
              📣 Call UNO!
            </button>
          )}

          {me && gameState.unoCalls[me.id] && (
            <span
              className="badge badge-host"
              style={{ padding: '8px 16px', borderRadius: '20px', fontWeight: 800 }}
            >
              📢 UNO Called
            </span>
          )}

          {/* Jump-in out-of-turn play triggers */}
          {players.length > 0 && !isMyTurn && myCards.map(card => {
            const exactMatch = card.color === topCard.color && card.value === topCard.value;
            if (exactMatch) {
              return (
                <button
                  key={card.id}
                  onClick={() => onPlayCard(card.id)} // will route to jumpIn play
                  className="btn btn-warning pulse-glow"
                  style={{ padding: '6px 12px', fontSize: '0.8rem', fontWeight: 'bold' }}
                >
                  ⚡ Jump-In {card.value}!
                </button>
              );
            }
            return null;
          })}
        </div>
      </div>

      {/* Draw Decision dialog overlay */}
      {drawnCardInfo && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ maxWidth: '340px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '16px', fontFamily: 'var(--font-display)' }}>
              Card Drawn
            </h3>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
              <Card card={drawnCardInfo.card} isPlayable={false} size="md" colorblindMode={colorblindMode} />
            </div>

            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              {drawnCardInfo.isPlayable
                ? 'Would you like to play this card immediately or keep it and pass?'
                : 'This card is not playable. Your turn is passed.'}
            </p>

            <div style={{ display: 'flex', gap: '12px' }}>
              {drawnCardInfo.isPlayable ? (
                <>
                  <button onClick={handlePassClick} className="btn btn-secondary" style={{ flex: 1 }}>
                    Keep & Pass
                  </button>
                  <button onClick={handlePlayDrawnClick} className="btn btn-success" style={{ flex: 1 }}>
                    Play Card
                  </button>
                </>
              ) : (
                <button onClick={onResetDrawnCard} className="btn btn-primary" style={{ width: '100%' }}>
                  OK
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Color picker modal */}
      {showColorPicker && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel">
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800 }}>Choose Wild Color</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
              Select the active color for the next player:
            </p>
            <div className="color-wheel">
              <button onClick={() => handleSelectColor('red')} className="color-sector sector-red" />
              <button onClick={() => handleSelectColor('green')} className="color-sector sector-green" />
              <button onClick={() => handleSelectColor('blue')} className="color-sector sector-blue" />
              <button onClick={() => handleSelectColor('yellow')} className="color-sector sector-yellow" />
            </div>
          </div>
        </div>
      )}

      {/* Challenge Wild Draw 4 dialog overlay */}
      {gameState.pendingChallenge && (
        <div className="modal-overlay" style={{ zIndex: 1010 }}>
          <div className="modal-content glass-panel" style={{ maxWidth: '380px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '12px', fontFamily: 'var(--font-display)' }}>
              🛡️ Wild Draw 4 Challenge
            </h3>
            {gameState.pendingChallenge.challengerId === currentUserSocketId ? (
              <>
                <p style={{ fontSize: '0.9rem', color: 'white', marginBottom: '16px' }}>
                  {players.find(p => p.id === gameState.pendingChallenge?.playerId)?.name || 'An opponent'} played a Wild Draw 4 on you. Do you suspect they are bluffing (holding a card matching the active color in hand)?
                </p>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                  • If they bluffed, they draw 4 cards penalty instead of you.<br/>
                  • If they played honestly, you draw 6 cards!
                </p>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button onClick={() => onResolveChallenge?.('challenge')} className="btn btn-danger" style={{ flex: 1 }}>
                    Challenge Bluff
                  </button>
                  <button onClick={() => onResolveChallenge?.('accept')} className="btn btn-success" style={{ flex: 1 }}>
                    Accept Draw
                  </button>
                </div>
              </>
            ) : (
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Waiting for {players.find(p => p.id === gameState.pendingChallenge?.challengerId)?.name || 'target player'} to resolve Wild Draw 4 challenge...
              </p>
            )}
          </div>
        </div>
      )}

      {/* Seven-O Hand Swap Target Selection Overlay */}
      {gameState.pendingHandSwap && (
        <div className="modal-overlay" style={{ zIndex: 1010 }}>
          <div className="modal-content glass-panel" style={{ maxWidth: '380px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '12px', fontFamily: 'var(--font-display)', textAlign: 'center' }}>
              🤝 Choose Swap Target
            </h3>
            {gameState.pendingHandSwap.playerId === currentUserSocketId ? (
              <>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '16px', textAlign: 'center' }}>
                  Select an opponent to swap your entire card hand with:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                  {players.filter(p => p.id !== currentUserSocketId).map(p => (
                    <button
                      key={p.id}
                      onClick={() => onSwapHands?.(p.id)}
                      className="btn btn-secondary"
                      style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: '8px' }}
                    >
                      <span>{p.name}</span>
                      <span style={{ color: 'var(--color-yellow)' }}>({p.cardCount || 0} cards)</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                Waiting for {players.find(p => p.id === gameState.pendingHandSwap?.playerId)?.name || 'swapping player'} to select hand swap target...
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
