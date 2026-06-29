import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3000';

console.log('🏁 Starting WebSocket integration test...');

const socket = io(SOCKET_URL, {
  forceNew: true,
  transports: ['websocket'],
});

let testTimeout = setTimeout(() => {
  console.error('❌ Test timed out!');
  socket.close();
  process.exit(1);
}, 25000);

socket.on('connect', () => {
  console.log('✅ Connected to local UNO server on port 3000.');
  
  // Start matchmaking search
  console.log('⚡ Emitting findMatch (Quick mode)...');
  socket.emit('findMatch', {
    mode: 'quick',
    playerName: 'TesterHuman',
    rating: 1000,
  });
});

socket.on('matchmakingStarted', ({ mode }) => {
  console.log(`✅ Received matchmakingStarted. Mode: ${mode}. Waiting for matchmaking loop filler...`);
});

socket.on('matchFound', (roomCode) => {
  console.log(`🎉 Match found! Room Code: ${roomCode}`);
});

socket.on('roomStateUpdate', (state) => {
  console.log(`📋 Received Room Update. Status: ${state.status}. Total players: ${state.players.length}`);
  
  if (state.status === 'playing') {
    console.log('🎮 Game has successfully transitioned to playing status!');
    console.log('Discard pile top:', state.gameState.discardPile[state.gameState.discardPile.length - 1]);
    
    // Clean exit
    clearTimeout(testTimeout);
    socket.close();
    console.log('✅ ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  }
});

socket.on('connect_error', (err) => {
  console.error('❌ Connection error:', err.message);
  clearTimeout(testTimeout);
  process.exit(1);
});
