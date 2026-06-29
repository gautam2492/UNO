import React from 'react';
import './Card.css';

export interface CardData {
  id: string;
  type: 'number' | 'skip' | 'reverse' | 'draw_2' | 'wild' | 'wild_draw';
  color: 'red' | 'green' | 'blue' | 'yellow' | 'wild';
  value: number | string;
  drawAmount: number;
}

interface CardProps {
  card?: CardData; // Undefined if we just want to render a card back
  isPlayable?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  size?: 'sm' | 'md' | 'lg';
  isBack?: boolean;
  colorblindMode?: boolean;
}

export const Card: React.FC<CardProps> = ({
  card,
  isPlayable = false,
  onClick,
  style = {},
  size = 'md',
  isBack = false,
  colorblindMode = false,
}) => {
  const isCardBack = isBack || !card;

  // Get card display value/icon
  const getCardIcon = () => {
    if (!card) return '';
    switch (card.type) {
      case 'skip':
        return (
          <svg className="uno-card-center-svg" viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8 0-1.85.63-3.55 1.69-4.9L16.9 18.31C15.55 19.37 13.85 20 12 20zm5.31-3.1L6.9 6.09C8.25 5.03 9.95 4.4 12 4.4c4.42 0 8 3.58 8 8 0 1.85-.63 3.55-1.69 4.9z"/>
          </svg>
        );
      case 'reverse':
        return (
          <svg className="uno-card-center-svg" viewBox="0 0 24 24" width="32" height="32" fill="currentColor">
            <path d="M19 8l-4 4h3c0 3.31-2.69 6-6 6-1.01 0-1.97-.25-2.8-.7l-1.46 1.46C8.97 19.54 10.43 20 12 20c4.42 0 8-3.58 8-8h3l-4-4zM6 12c0-3.31 2.69-6 6-6 1.01 0 1.97.25 2.8.7l1.46-1.46C15.03 4.46 13.57 4 12 4c-4.42 0-8 3.58-8 8H1l4 4 4-4H6z"/>
          </svg>
        );
      case 'draw_2':
        return '+2';
      case 'wild':
        return 'W';
      case 'wild_draw':
        return `+${card.drawAmount}`;
      default:
        return card.value;
    }
  };

  const getSmallIcon = () => {
    if (!card) return '';
    if (card.type === 'skip') return 'Ø';
    if (card.type === 'reverse') return '⇄';
    if (card.type === 'draw_2') return '+2';
    if (card.type === 'wild') return 'W';
    if (card.type === 'wild_draw') return `+${card.drawAmount}`;
    return card.value;
  };

  const getColorAbbr = () => {
    if (!card || card.color === 'wild') return '';
    switch (card.color) {
      case 'red': return 'R';
      case 'green': return 'G';
      case 'blue': return 'B';
      case 'yellow': return 'Y';
      default: return '';
    }
  };

  if (isCardBack) {
    return (
      <div
        className={`uno-card uno-card-${size} uno-card-back`}
        style={style}
      >
        <div className="uno-card-back-inner">
          <span className="uno-card-back-logo">UNO</span>
        </div>
      </div>
    );
  }

  // Determine card design classes
  const isWild = card.color === 'wild';
  const cardColorClass = `uno-card-${card.color}`;
  const playabilityClass = isPlayable ? 'uno-card-playable' : 'uno-card-unplayable';
  const innerOvalClass = isWild ? 'uno-card-inner-oval-wild' : 'uno-card-inner-oval-standard';
  const textClass = isWild ? 'uno-card-wild-text' : '';

  return (
    <button
      onClick={isPlayable && onClick ? onClick : undefined}
      disabled={!isPlayable}
      className={`uno-card uno-card-${size} ${cardColorClass} ${playabilityClass}`}
      style={style}
    >
      {/* Top Left Corner Indicator */}
      <div className="uno-card-corner" style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
        <span>{getSmallIcon()}</span>
        {colorblindMode && getColorAbbr() && (
          <span style={{ fontSize: '0.6rem', opacity: 0.85, fontWeight: 900, background: 'rgba(0,0,0,0.5)', color: 'white', padding: '1px 3px', borderRadius: '4px' }}>
            {getColorAbbr()}
          </span>
        )}
      </div>

      {/* Center Oval Container */}
      <div className={`uno-card-inner-oval ${innerOvalClass}`}>
        <span className={`uno-card-center-val ${textClass}`}>
          {getCardIcon()}
        </span>
      </div>

      {/* Bottom Right Corner Indicator (Inverted) */}
      <div className="uno-card-corner uno-card-corner-bottom" style={{ display: 'flex', alignItems: 'center', gap: '2px', flexDirection: 'row-reverse' }}>
        <span>{getSmallIcon()}</span>
        {colorblindMode && getColorAbbr() && (
          <span style={{ fontSize: '0.6rem', opacity: 0.85, fontWeight: 900, background: 'rgba(0,0,0,0.5)', color: 'white', padding: '1px 3px', borderRadius: '4px', transform: 'rotate(180deg)' }}>
            {getColorAbbr()}
          </span>
        )}
      </div>

      {/* Playable Border Glow Overlay */}
      {isPlayable && <div className="uno-card-glow"></div>}
    </button>
  );
};
