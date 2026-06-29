import React, { useState, useEffect, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import confetti from 'canvas-confetti';
import { Lobby } from './components/Lobby';
import { GameBoard } from './components/GameBoard';
import { Chat } from './components/Chat';
import { useSound } from './hooks/useSound';

interface ChatMessage {
  sender: string;
  text: string;
  timestamp: number;
}

interface EmojiObject {
  id: string;
  playerId: string;
  emoji: string;
}

const getSocketUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const serverParam = params.get('server');
  if (serverParam) return serverParam;
  
  return (window.location.hostname === 'localhost' || window.location.hostname.endsWith('github.io'))
    ? 'http://localhost:3000' 
    : window.location.origin;
};

const SOCKET_URL = getSocketUrl();

export const App: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [screen, setScreen] = useState<'landing' | 'lobby' | 'game' | 'gameover'>('landing');
  const [roomState, setRoomState] = useState<any>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [drawnCard, setDrawnCard] = useState<{ card: any; isPlayable: boolean } | null>(null);
  
  // Voice chat & Emoji states
  const [activeEmojis, setActiveEmojis] = useState<EmojiObject[]>([]);
  const [voiceMuted, setVoiceMuted] = useState(false);
  const [voiceMutedStates, setVoiceMutedStates] = useState<Record<string, boolean>>({});
  const [locallyMuted, setLocallyMuted] = useState<Record<string, boolean>>({});
  const [voiceMode, setVoiceMode] = useState<'open' | 'ptt'>('open');
  const [voiceQuality, setVoiceQuality] = useState<'low' | 'medium' | 'high'>('medium');

  // Matchmaking states
  const [isMatchmaking, setIsMatchmaking] = useState(false);
  const [matchmakingMode, setMatchmakingMode] = useState<'quick' | 'ranked' | 'casual' | null>(null);
  const [matchmakingSeconds, setMatchmakingSeconds] = useState(0);

  // Accessibility states
  const [colorblindMode, setColorblindMode] = useState(false);

  const { playWinSound, playErrorSound } = useSound();
  
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Record<string, RTCPeerConnection>>({});
  const autoStartBotsRef = useRef(false);
  
  const roomCodeRef = useRef('');
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  const voiceMutedRef = useRef(false);
  useEffect(() => {
    voiceMutedRef.current = voiceMuted;
  }, [voiceMuted]);

  const voiceModeRef = useRef<'open' | 'ptt'>('open');
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  // Parse invite room parameters on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room') || params.get('r');
    if (code) {
      setInputRoomCode(code.toUpperCase().trim());
      // Suggest player name if empty
      setPlayerName(localStorage.getItem('playerName') || '');
    }
  }, []);

  // Matchmaking elapsed timer ticker
  useEffect(() => {
    let interval: any = null;
    if (isMatchmaking) {
      interval = setInterval(() => {
        setMatchmakingSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setMatchmakingSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isMatchmaking]);

  // Push to talk hotkey (Spacebar) listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (voiceModeRef.current === 'ptt' && e.code === 'Space') {
        // Prevent scroll
        e.preventDefault();
        unmuteMicPTT();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (voiceModeRef.current === 'ptt' && e.code === 'Space') {
        e.preventDefault();
        muteMicPTT();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const unmuteMicPTT = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
      socketRef.current?.emit('voiceStateUpdate', { roomCode: roomCodeRef.current, isMuted: false });
    }
  };

  const muteMicPTT = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
      socketRef.current?.emit('voiceStateUpdate', { roomCode: roomCodeRef.current, isMuted: true });
    }
  };

  // WebRTC Peer Connection Helper
  const createPeerConnection = (peerPlayerId: string, activeSocket: Socket) => {
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        activeSocket.emit('voice-signal', {
          roomCode: roomCodeRef.current,
          targetId: peerPlayerId,
          signal: { type: 'candidate', candidate: event.candidate }
        });
      }
    };

    peer.ontrack = (event) => {
      let audio = document.getElementById(`audio_${peerPlayerId}`) as HTMLAudioElement;
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio_${peerPlayerId}`;
        audio.autoplay = true;
        document.body.appendChild(audio);
      }
      audio.srcObject = event.streams[0];
      // Sync local mute blocks
      audio.muted = !!locallyMuted[peerPlayerId];
    };

    // Add local tracks if microphone is active
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peer.addTrack(track, localStreamRef.current!);
      });
    }

    return peer;
  };

  // Start P2P WebRTC voice calls
  const startVoiceChat = async (activeSocket: Socket, playersList: any[]) => {
    try {
      // Set audio sample rate constraints based on selected quality
      const constraints = {
        audio: {
          sampleRate: voiceQuality === 'low' ? 8000 : voiceQuality === 'high' ? 48000 : 24000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;

      // Apply initial mute state (if PTT, starting state is muted until Spacebar pressed)
      const shouldMute = voiceMode === 'ptt' ? true : voiceMuted;
      stream.getAudioTracks().forEach(track => {
        track.enabled = !shouldMute;
      });

      // Broadcast voice status to room
      activeSocket.emit('voiceStateUpdate', { roomCode: roomCodeRef.current, isMuted: shouldMute });

      // Establish RTC offer connection with each non-bot human player
      playersList.forEach(async (player) => {
        if (player.id === activeSocket.id || player.isBot) return;

        const peer = createPeerConnection(player.id, activeSocket);
        peersRef.current[player.id] = peer;

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        activeSocket.emit('voice-signal', {
          roomCode: roomCodeRef.current,
          targetId: player.id,
          signal: { type: 'offer', sdp: offer }
        });
      });
    } catch (err) {
      console.warn("Could not acquire microphone access for Voice Chat:", err);
    }
  };

  const handleToggleVoiceMute = () => {
    const nextMute = !voiceMuted;
    setVoiceMuted(nextMute);
    if (localStreamRef.current && voiceMode !== 'ptt') {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !nextMute;
      });
      socket?.emit('voiceStateUpdate', { roomCode, isMuted: nextMute });
    }
  };

  const cleanUpVoiceChat = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    Object.keys(peersRef.current).forEach(peerId => {
      peersRef.current[peerId].close();
      const audio = document.getElementById(`audio_${peerId}`);
      if (audio) {
        audio.remove();
      }
    });
    peersRef.current = {};
    setVoiceMutedStates({});
  };

  // Toggle local mute of specific peer
  const handleToggleMutePeer = (peerId: string) => {
    const audio = document.getElementById(`audio_${peerId}`) as HTMLAudioElement;
    const nextLocallyMuted = !locallyMuted[peerId];
    setLocallyMuted(prev => ({ ...prev, [peerId]: nextLocallyMuted }));
    if (audio) {
      audio.muted = nextLocallyMuted;
    }
  };

  // Initialize socket
  useEffect(() => {
    const newSocket = io(SOCKET_URL);
    setSocket(newSocket);
    socketRef.current = newSocket;

    // Socket listeners
    newSocket.on('roomCreated', (code: string) => {
      setRoomCode(code);
      setScreen('lobby');
      setErrorMsg('');
    });

    newSocket.on('roomJoined', (code: string) => {
      setRoomCode(code);
      setScreen('lobby');
      setErrorMsg('');
    });

    newSocket.on('errorMsg', (msg: string) => {
      setErrorMsg(msg);
      playErrorSound();
      setTimeout(() => setErrorMsg(''), 4000);
    });

    newSocket.on('roomStateUpdate', (state: any) => {
      setRoomState(state);
      setMessages(state.messages || []);
      
      if (state.status === 'playing') {
        const prevScreen = screen;
        setScreen('game');
        // Auto-join voice when switching to the table
        if (prevScreen !== 'game') {
          startVoiceChat(newSocket, state.players);
        }
      } else if (state.status === 'gameover') {
        setScreen('gameover');
        cleanUpVoiceChat();
      } else if (state.status === 'lobby') {
        setScreen('lobby');
        cleanUpVoiceChat();
        
        // Fast-track solo play vs bots starts
        if (autoStartBotsRef.current) {
          autoStartBotsRef.current = false;
          setTimeout(() => newSocket.emit('addBot', { roomCode: state.code }), 100);
          setTimeout(() => newSocket.emit('addBot', { roomCode: state.code }), 200);
          setTimeout(() => newSocket.emit('addBot', { roomCode: state.code }), 300);
          setTimeout(() => newSocket.emit('startGame', { roomCode: state.code }), 500);
        }
      }
    });

    newSocket.on('timerTick', ({ secondsLeft }) => {
      setRoomState((prev: any) => {
        if (!prev || !prev.gameState) return prev;
        return {
          ...prev,
          gameState: {
            ...prev.gameState,
            timerSeconds: secondsLeft
          }
        };
      });
    });

    newSocket.on('chatMessage', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });

    newSocket.on('emojiReceived', ({ playerId, emoji }) => {
      const id = Math.random().toString();
      setActiveEmojis(prev => [...prev, { id, playerId, emoji }]);
      setTimeout(() => {
        setActiveEmojis(prev => prev.filter(e => e.id !== id));
      }, 2000);
    });

    newSocket.on('kicked', () => {
      alert('You have been kicked from the room by the host.');
      cleanUpVoiceChat();
      setScreen('landing');
      setRoomState(null);
    });

    newSocket.on('drawnCardInfo', (info: { card: any; isPlayable: boolean }) => {
      setDrawnCard(info);
    });

    newSocket.on('playCardRedirect', ({ cardId, chosenColor }) => {
      newSocket.emit('playCard', { roomCode: roomCodeRef.current, cardId, chosenColor });
    });

    // Matchmaking events
    newSocket.on('matchmakingStarted', ({ mode }) => {
      setIsMatchmaking(true);
      setMatchmakingMode(mode);
      setMatchmakingSeconds(0);
    });

    newSocket.on('matchmakingCancelled', () => {
      setIsMatchmaking(false);
      setMatchmakingMode(null);
    });

    newSocket.on('matchFound', (code: string) => {
      setRoomCode(code);
      setIsMatchmaking(false);
      setScreen('game');
    });

    // WebRTC connection signaling receiver
    newSocket.on('voice-signal', async ({ senderId, signal }) => {
      const peers = peersRef.current;
      let peer = peers[senderId];

      if (signal.type === 'offer') {
        peer = createPeerConnection(senderId, newSocket);
        peers[senderId] = peer;
        await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        newSocket.emit('voice-signal', {
          roomCode: roomCodeRef.current,
          targetId: senderId,
          signal: { type: 'answer', sdp: answer }
        });
      } else if (signal.type === 'answer') {
        if (peer) {
          await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        }
      } else if (signal.type === 'candidate') {
        if (peer) {
          try {
            await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (e) {
            console.error("Error adding WebRTC ICE Candidate:", e);
          }
        }
      }
    });

    newSocket.on('voiceStateUpdated', ({ playerId, isMuted }) => {
      setVoiceMutedStates(prev => ({ ...prev, [playerId]: isMuted }));
    });

    return () => {
      cleanUpVoiceChat();
      newSocket.close();
    };
  }, []);

  // Victory Confetti
  useEffect(() => {
    if (screen === 'gameover' && roomState?.gameState?.winner) {
      playWinSound();
      const duration = 4 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 28, spread: 360, ticks: 60, zIndex: 1000 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval = setInterval(() => {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 45 * (timeLeft / duration);
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
        });
        confetti({
          ...defaults,
          particleCount,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
        });
      }, 250);

      return () => clearInterval(interval);
    }
  }, [screen, roomState]);

  const handleStartMatchmaking = (mode: 'quick' | 'ranked' | 'casual') => {
    let name = playerName.trim();
    if (!name) {
      name = 'Player_' + Math.floor(Math.random()*900 + 100);
      setPlayerName(name);
    }
    localStorage.setItem('playerName', name);
    socket?.emit('findMatch', { mode, playerName: name, rating: 1000 });
  };

  const handleCancelMatchmaking = () => {
    socket?.emit('cancelMatchmaking');
  };

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      setErrorMsg('Please enter your name.');
      return;
    }
    localStorage.setItem('playerName', playerName.trim());
    socket?.emit('createRoom', { playerName: playerName.trim() });
  };

  const handleJoinRoom = () => {
    if (!playerName.trim()) {
      setErrorMsg('Please enter your name.');
      return;
    }
    if (!inputRoomCode.trim()) {
      setErrorMsg('Please enter a room code.');
      return;
    }
    localStorage.setItem('playerName', playerName.trim());
    socket?.emit('joinRoom', {
      roomCode: inputRoomCode.trim().toUpperCase(),
      playerName: playerName.trim()
    });
  };

  const handleToggleReady = () => {
    socket?.emit('toggleReady', { roomCode });
  };

  const handleUpdateSettings = (settings: any) => {
    socket?.emit('updateSettings', { roomCode, settings });
  };

  const handleStartGame = () => {
    socket?.emit('startGame', { roomCode });
  };

  const handleAddBot = () => {
    socket?.emit('addBot', { roomCode });
  };

  const handleKickPlayer = (playerId: string) => {
    socket?.emit('kickPlayer', { roomCode, playerId });
  };

  const handlePromoteHost = (playerId: string) => {
    socket?.emit('promoteHost', { roomCode, playerId });
  };

  const handlePlayCard = (cardId: string, chosenColor?: string) => {
    // Check if card is a jump-in play
    const me = roomState?.players.find((p: any) => p.id === socket?.id);
    const isMyTurn = roomState?.players[roomState?.gameState?.currentTurn]?.id === socket?.id;
    if (me && !isMyTurn && roomState?.settings?.jumpInEnabled) {
      socket?.emit('jumpIn', { roomCode, cardId, chosenColor });
    } else {
      socket?.emit('playCard', { roomCode, cardId, chosenColor });
    }
  };

  const handleDrawCard = () => {
    socket?.emit('drawCard', { roomCode });
  };

  const handlePassTurn = () => {
    setDrawnCard(null);
    socket?.emit('passTurn', { roomCode });
  };

  const handlePlayDrawnCard = (chosenColor?: string) => {
    setDrawnCard(null);
    socket?.emit('playDrawnCard', { roomCode, chosenColor });
  };

  const handleDeclareUno = () => {
    socket?.emit('declareUno', { roomCode });
  };

  const handleCatchUno = (targetPlayerId: string) => {
    socket?.emit('catchUno', { roomCode, targetPlayerId });
  };

  const handleResolveChallenge = (action: 'challenge' | 'accept') => {
    socket?.emit('resolveChallenge', { roomCode, action });
  };

  const handleSwapHands = (targetPlayerId: string) => {
    socket?.emit('swapHands', { roomCode, targetPlayerId });
  };

  const handleSendMessage = (text: string) => {
    socket?.emit('sendMessage', { roomCode, text });
  };

  const handlePlayWithBots = () => {
    let name = playerName.trim();
    if (!name) {
      name = 'Player';
      setPlayerName('Player');
    }
    localStorage.setItem('playerName', name);
    autoStartBotsRef.current = true;
    socket?.emit('createRoom', { playerName: name });
  };

  const handleLeaveGame = () => {
    cleanUpVoiceChat();
    window.location.reload();
  };

  // Render screens
  if (screen === 'landing') {
    return (
      <div className="lobby-container">
        <div className="lobby-box glass-panel" style={{ padding: '36px', maxWidth: '440px', width: '92%' }}>
          <h1 className="lobby-title" style={{ fontSize: '2.5rem' }}>🚀 UNO Mobile</h1>
          <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '-12px', marginBottom: '20px' }}>
            Play online matchmaking, practice offline, or host custom rooms!
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 600 }}>
                Your Nickname
              </label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter name (e.g. Gautam)"
                maxLength={12}
                className="glass-input"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button onClick={() => handleStartMatchmaking('quick')} className="btn btn-primary" style={{ padding: '12px 6px', fontSize: '0.85rem' }}>
                ⚡ Quick Match
              </button>
              <button onClick={() => handleStartMatchmaking('ranked')} className="btn btn-warning" style={{ padding: '12px 6px', fontSize: '0.85rem', color: 'black' }}>
                🏆 Ranked Match
              </button>
            </div>

            <button onClick={handlePlayWithBots} className="btn btn-success" style={{ width: '100%' }}>
              🤖 Solo vs AI Bots (Offline)
            </button>

            <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

            <button onClick={handleCreateRoom} className="btn btn-secondary" style={{ width: '100%' }}>
              🛡️ Create Custom Room
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>OR ENTER INVITE CODE</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={inputRoomCode}
                onChange={(e) => setInputRoomCode(e.target.value)}
                placeholder="Lobby Code"
                maxLength={6}
                className="glass-input"
                style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '1px', fontFamily: 'var(--font-display)', fontWeight: 700 }}
              />
              <button onClick={handleJoinRoom} className="btn btn-secondary">
                Join
              </button>
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
                marginTop: '16px'
              }}
            >
              {errorMsg}
            </div>
          )}
        </div>

        {/* Matchmaking status overlay */}
        {isMatchmaking && (
          <div className="lobby-container" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.85)' }}>
            <div className="lobby-box glass-panel" style={{ padding: '36px', textAlign: 'center', maxWidth: '360px', width: '90%' }}>
              <h2 style={{ fontSize: '1.6rem', margin: '0 0 10px 0', fontFamily: 'var(--font-display)' }}>🔍 Finding Match...</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
                Mode: <strong style={{ color: 'var(--color-yellow)' }}>{matchmakingMode?.toUpperCase()} Match</strong>
              </p>
              
              <div style={{ margin: '0 auto 20px auto', width: '50px', height: '50px', borderRadius: '50%', border: '4px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--color-blue)', animation: 'pulse-stack 1s infinite linear' }} />
              
              <p style={{ fontSize: '1rem', fontWeight: 'bold', margin: '0 0 24px 0' }}>
                Searching: <span style={{ color: 'var(--color-blue)' }}>{matchmakingSeconds}s</span>
              </p>

              <button onClick={handleCancelMatchmaking} className="btn btn-danger" style={{ width: '100%' }}>
                Cancel Search
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (screen === 'lobby' && roomState) {
    return (
      <Lobby
        roomCode={roomCode}
        players={roomState.players}
        settings={roomState.settings}
        currentUserSocketId={socket?.id || ''}
        onToggleReady={handleToggleReady}
        onUpdateSettings={handleUpdateSettings}
        onStartGame={handleStartGame}
        errorMsg={errorMsg}
        onAddBot={handleAddBot}
        onKickPlayer={handleKickPlayer}
        onPromoteHost={handlePromoteHost}
      />
    );
  }

  if (screen === 'game' && roomState) {
    return (
      <div className="game-container">
        <GameBoard
          gameState={roomState.gameState}
          players={roomState.players}
          currentUserSocketId={socket?.id || ''}
          drawnCardInfo={drawnCard}
          onPlayCard={handlePlayCard}
          onDrawCard={handleDrawCard}
          onPassTurn={handlePassTurn}
          onPlayDrawnCard={handlePlayDrawnCard}
          onDeclareUno={handleDeclareUno}
          onCatchUno={handleCatchUno}
          onResetDrawnCard={() => setDrawnCard(null)}
          activeEmojis={activeEmojis}
          voiceMutedStates={voiceMutedStates}
          colorblindMode={colorblindMode}
          onResolveChallenge={handleResolveChallenge}
          onSwapHands={handleSwapHands}
          locallyMuted={locallyMuted}
          onToggleMutePeer={handleToggleMutePeer}
        />
        
        {/* Sidebar panels */}
        <div className="sidebar-panel">
          {/* Voice Chat Control Area */}
          <div
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--glass-border)',
              background: 'rgba(255, 255, 255, 0.01)',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>🎙️ Voice Call</span>
              <button
                onClick={handleToggleVoiceMute}
                disabled={voiceMode === 'ptt'}
                className={`btn ${voiceMuted ? 'btn-danger' : 'btn-success'}`}
                style={{ padding: '4px 10px', fontSize: '0.75rem', minWidth: '85px', opacity: voiceMode === 'ptt' ? 0.6 : 1 }}
              >
                {voiceMode === 'ptt' ? 'Space to Talk' : voiceMuted ? '🔇 Muted' : '🔊 Speaking'}
              </button>
            </div>

            {/* Quality & Mode Selects */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ flex: 1 }}>
                <select
                  value={voiceMode}
                  onChange={(e) => setVoiceMode(e.target.value as any)}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '4px', borderRadius: '6px', fontSize: '0.7rem' }}
                >
                  <option value="open">Open Mic</option>
                  <option value="ptt">Push To Talk</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <select
                  value={voiceQuality}
                  onChange={(e) => setVoiceQuality(e.target.value as any)}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.4)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', padding: '4px', borderRadius: '6px', fontSize: '0.7rem' }}
                >
                  <option value="low">Low Quality</option>
                  <option value="medium">Med Quality</option>
                  <option value="high">High Quality</option>
                </select>
              </div>
            </div>
          </div>

          {/* Quick Reaction Emojis Panel */}
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--glass-border)',
              display: 'flex',
              justifyContent: 'space-around',
              background: 'rgba(255, 255, 255, 0.02)'
            }}
          >
            {['😂', '😮', '😡', '👍', '🎉'].map(emoji => (
              <button
                key={emoji}
                onClick={() => socket?.emit('sendEmoji', { roomCode, emoji })}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.6rem',
                  cursor: 'pointer',
                  transition: 'transform 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.25)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Accessibility & Options Panel */}
          <div
            style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--glass-border)',
              background: 'rgba(255, 255, 255, 0.01)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>👁️ Colorblind Mode</span>
              <input
                type="checkbox"
                checked={colorblindMode}
                onChange={(e) => setColorblindMode(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
            </div>
          </div>

          {/* Chat Window */}
          <Chat messages={messages} onSendMessage={handleSendMessage} />
        </div>
      </div>
    );
  }

  if (screen === 'gameover' && roomState) {
    const winnerId = roomState.gameState.winner;
    const winnerPlayer = roomState.players.find((p: any) => p.id === winnerId);
    const isYouWinner = winnerId === socket?.id;

    return (
      <div className="lobby-container">
        <div className="lobby-box glass-panel text-center" style={{ textAlign: 'center', padding: '40px', maxWidth: '440px', width: '92%' }}>
          <h1 className="lobby-title" style={{ fontSize: '3rem', margin: 0 }}>
            {isYouWinner ? '🏆 VICTORY!' : '🎮 GAME OVER'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', margin: '12px 0 30px 0', fontSize: '1.1rem' }}>
            {isYouWinner ? (
              <span style={{ color: 'var(--color-yellow)', fontWeight: 800 }}>
                You won the game! Congratulations!
              </span>
            ) : (
              <span>
                Winner is <strong style={{ color: 'white' }}>{winnerPlayer?.name || 'Unknown'}</strong>.
              </span>
            )}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button onClick={handleLeaveGame} className="btn btn-primary" style={{ width: '100%' }}>
              Leave Game Room
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-container">
      <div style={{ color: 'var(--text-secondary)' }}>Connecting to server...</div>
    </div>
  );
};

export default App;
