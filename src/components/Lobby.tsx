import React from 'react';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  isHost: boolean;
  isBot?: boolean;
  cardCount?: number;
}

interface LobbyProps {
  roomCode: string;
  players: Player[];
  settings: {
    stackingEnabled: boolean;
    timerDuration: number;
    stackMaxLimit: number;
    mixedStacking: boolean;
    jumpInEnabled: boolean;
    sevenZeroEnabled: boolean;
    drawUntilPlayable: boolean;
    noBluffChallenge: boolean;
    spectatorsEnabled: boolean;
    maxPlayers: number;
  };
  currentUserSocketId: string;
  onToggleReady: () => void;
  onUpdateSettings: (settings: any) => void;
  onStartGame: () => void;
  errorMsg: string;
  onAddBot: () => void;
  onKickPlayer: (playerId: string) => void;
  onPromoteHost?: (playerId: string) => void;
}

export const Lobby: React.FC<LobbyProps> = ({
  roomCode,
  players,
  settings,
  currentUserSocketId,
  onToggleReady,
  onUpdateSettings,
  onStartGame,
  errorMsg,
  onAddBot,
  onKickPlayer,
  onPromoteHost,
}) => {
  const currentPlayer = players.find(p => p.id === currentUserSocketId);
  const isHost = currentPlayer?.isHost || false;

  const handleCopyCode = () => {
    const inviteLink = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
    navigator.clipboard.writeText(inviteLink);
    alert('Invite link copied to clipboard!');
  };

  const updateSetting = (key: string, value: any) => {
    onUpdateSettings({
      ...settings,
      [key]: value,
    });
  };

  const allPlayersReady = players.every(p => p.isReady);
  const canStartGame = isHost && players.length >= 2 && allPlayersReady;

  return (
    <div className="lobby-container">
      <div className="lobby-box glass-panel" style={{ maxWidth: '640px', width: '92%' }}>
        <h1 className="lobby-title">UNO Lobby</h1>

        <div className="room-info">
          <p style={{ color: 'var(--text-secondary)', marginBottom: '6px', fontSize: '0.9rem' }}>
            Share this invite link with friends to play:
          </p>
          <div className="room-code-panel" style={{ display: 'flex', gap: '8px', padding: '10px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontFamily: 'var(--font-display)', color: 'var(--color-yellow)', fontWeight: 800 }}>
              {roomCode}
            </span>
            <button
              onClick={handleCopyCode}
              className="btn btn-secondary"
              style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: '8px' }}
            >
              🔗 Copy Invite Link
            </button>
          </div>
        </div>

        {/* Dynamic Rules Box */}
        <div
          className="settings-box"
          style={{
            background: 'rgba(255, 255, 255, 0.01)',
            padding: '16px',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <h3 style={{ fontSize: '1rem', margin: 0, fontFamily: 'var(--font-display)', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '8px' }}>
            ⚙️ Room Rules & Match Config
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            {/* Stacking */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Stacking Rules (+2/+4)</span>
              <input
                type="checkbox"
                checked={settings.stackingEnabled || false}
                onChange={(e) => updateSetting('stackingEnabled', e.target.checked)}
                disabled={!isHost}
                style={{ cursor: isHost ? 'pointer' : 'default' }}
              />
            </div>

            {/* Mixed Stacking */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Mixed Stacking (+2 on +4)</span>
              <input
                type="checkbox"
                checked={settings.mixedStacking || false}
                onChange={(e) => updateSetting('mixedStacking', e.target.checked)}
                disabled={!isHost || !settings.stackingEnabled}
              />
            </div>

            {/* Jump-In Rule */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>⚡ Jump-In (Out of turn)</span>
              <input
                type="checkbox"
                checked={settings.jumpInEnabled || false}
                onChange={(e) => updateSetting('jumpInEnabled', e.target.checked)}
                disabled={!isHost}
              />
            </div>

            {/* Seven-O Swap */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>🤝 Seven-O (Hand Swaps)</span>
              <input
                type="checkbox"
                checked={settings.sevenZeroEnabled || false}
                onChange={(e) => updateSetting('sevenZeroEnabled', e.target.checked)}
                disabled={!isHost}
              />
            </div>

            {/* Draw Until Playable */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>🔄 Force Draw (Until Playable)</span>
              <input
                type="checkbox"
                checked={settings.drawUntilPlayable || false}
                onChange={(e) => updateSetting('drawUntilPlayable', e.target.checked)}
                disabled={!isHost}
              />
            </div>

            {/* No Bluff Challenge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>🛡️ Disable +4 Bluff Challenge</span>
              <input
                type="checkbox"
                checked={settings.noBluffChallenge || false}
                onChange={(e) => updateSetting('noBluffChallenge', e.target.checked)}
                disabled={!isHost}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
            {/* Timer select */}
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Turn Timer</label>
              <select
                value={settings.timerDuration || 30}
                onChange={(e) => updateSetting('timerDuration', parseInt(e.target.value))}
                disabled={!isHost}
                style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '6px', borderRadius: '8px', fontSize: '0.8rem' }}
              >
                <option value="15">15 Seconds</option>
                <option value="30">30 Seconds</option>
                <option value="45">45 Seconds</option>
                <option value="60">60 Seconds</option>
              </select>
            </div>

            {/* Stacking Limit select */}
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Stack Limit</label>
              <select
                value={settings.stackMaxLimit || 0}
                onChange={(e) => updateSetting('stackMaxLimit', parseInt(e.target.value))}
                disabled={!isHost || !settings.stackingEnabled}
                style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '6px', borderRadius: '8px', fontSize: '0.8rem' }}
              >
                <option value="0">No Limit</option>
                <option value="4">Max +4</option>
                <option value="8">Max +8</option>
                <option value="10">Max +10</option>
                <option value="20">Max +20</option>
              </select>
            </div>
          </div>
        </div>

        {isHost && (
          <button
            onClick={onAddBot}
            className="btn btn-secondary"
            style={{ width: '100%', borderStyle: 'dashed', borderColor: 'var(--color-blue)', display: 'flex', gap: '8px', justifyContent: 'center' }}
          >
            🤖 Add AI Bot player
          </button>
        )}

        {/* Players List */}
        <div>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '12px', fontFamily: 'var(--font-display)' }}>
            Players ({players.length}/10)
          </h3>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              maxHeight: '220px',
              overflowY: 'auto',
              paddingRight: '4px',
            }}
          >
            {players.map(p => {
              const isYou = p.id === currentUserSocketId;
              return (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: isYou ? 'rgba(0, 180, 216, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid',
                    borderColor: isYou ? 'rgba(0, 180, 216, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    borderRadius: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    {isYou && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-blue)', fontWeight: 600 }}>
                        (You)
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {p.isHost && <span className="badge badge-host">Host</span>}
                    {p.isReady ? (
                      <span className="badge badge-ready">Ready</span>
                    ) : (
                      <span className="badge badge-pending">Waiting</span>
                    )}
                    {isHost && !isYou && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {onPromoteHost && !p.isBot && (
                          <button
                            onClick={() => onPromoteHost(p.id)}
                            className="btn btn-secondary"
                            style={{ padding: '3px 6px', fontSize: '0.65rem', borderRadius: '6px' }}
                            title="Promote to Host"
                          >
                            👑 Host
                          </button>
                        )}
                        <button
                          onClick={() => onKickPlayer(p.id)}
                          className="btn btn-danger"
                          style={{ padding: '3px 6px', fontSize: '0.65rem', borderRadius: '6px' }}
                        >
                          Kick
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {errorMsg && (
          <div
            style={{
              color: 'var(--color-red)',
              fontSize: '0.85rem',
              fontWeight: 600,
              textAlign: 'center',
              background: 'rgba(255, 77, 109, 0.1)',
              padding: '10px',
              borderRadius: '8px',
            }}
          >
            {errorMsg}
          </div>
        )}

        <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
          <button
            onClick={onToggleReady}
            className={`btn ${currentPlayer?.isReady ? 'btn-secondary' : 'btn-success'}`}
            style={{ flex: 1 }}
          >
            {currentPlayer?.isReady ? 'Unready' : 'Set Ready'}
          </button>

          {isHost && (
            <button
              onClick={onStartGame}
              disabled={!canStartGame}
              className="btn btn-primary"
              style={{ flex: 1.5 }}
            >
              Start Game
            </button>
          )}
        </div>

        {isHost && !canStartGame && (
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              marginTop: '-10px',
            }}
          >
            {players.length < 2
              ? 'Need at least 2 players to start.'
              : 'All players must be ready to start.'}
          </p>
        )}
      </div>
    </div>
  );
};
