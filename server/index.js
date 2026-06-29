import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());

// Server port
const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*', // In development, allow all origins
    methods: ['GET', 'POST']
  }
});

// Room database in-memory
const rooms = new Map();

// Matchmaking Queues
const matchmakingQueues = {
  quick: [],
  ranked: [],
  casual: []
};

// Check matchmaking queues every 1.5 seconds
setInterval(() => {
  processMatchmakingQueue('quick', 4, 8000);   // mode, targetSize, timeoutMs
  processMatchmakingQueue('ranked', 4, 12000);
  processMatchmakingQueue('casual', 4, 5000);
}, 1500);

// Helper to generate room codes
function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Generate a deck of cards
function generateDeck() {
  const colors = ['red', 'green', 'blue', 'yellow'];
  const deck = [];

  // Generate cards for each color
  colors.forEach(color => {
    // One '0' card
    deck.push({
      id: `${color}_0`,
      type: 'number',
      color,
      value: 0,
      drawAmount: 0
    });

    // Two of each number 1-9
    for (let i = 1; i <= 9; i++) {
      deck.push({ id: `${color}_${i}_1`, type: 'number', color, value: i, drawAmount: 0 });
      deck.push({ id: `${color}_${i}_2`, type: 'number', color, value: i, drawAmount: 0 });
    }

    // Two 'Skip', 'Reverse', 'Draw 2'
    for (let i = 1; i <= 2; i++) {
      deck.push({ id: `${color}_skip_${i}`, type: 'skip', color, value: 'skip', drawAmount: 0 });
      deck.push({ id: `${color}_reverse_${i}`, type: 'reverse', color, value: 'reverse', drawAmount: 0 });
      deck.push({ id: `${color}_draw2_${i}`, type: 'draw_2', color, value: 'draw_2', drawAmount: 2 });
    }
  });

  // Wild cards
  // 4 Standard Wild
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `wild_${i}`, type: 'wild', color: 'wild', value: 'wild', drawAmount: 0 });
  }
  // 4 Wild Draw 2
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `wild_draw_2_${i}`, type: 'wild_draw', color: 'wild', value: 'wild_draw_2', drawAmount: 2 });
  }
  // 4 Wild Draw 4
  for (let i = 1; i <= 4; i++) {
    deck.push({ id: `wild_draw_4_${i}`, type: 'wild_draw', color: 'wild', value: 'wild_draw_4', drawAmount: 4 });
  }
  // 2 Wild Draw 8
  for (let i = 1; i <= 2; i++) {
    deck.push({ id: `wild_draw_8_${i}`, type: 'wild_draw', color: 'wild', value: 'wild_draw_8', drawAmount: 8 });
  }
  // 2 Wild Draw 10
  for (let i = 1; i <= 2; i++) {
    deck.push({ id: `wild_draw_10_${i}`, type: 'wild_draw', color: 'wild', value: 'wild_draw_10', drawAmount: 10 });
  }
  // 2 Wild Draw 20
  for (let i = 1; i <= 2; i++) {
    deck.push({ id: `wild_draw_20_${i}`, type: 'wild_draw', color: 'wild', value: 'wild_draw_20', drawAmount: 20 });
  }

  return deck;
}

// Shuffle deck
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Sanitize room state to prevent players from seeing other players' cards
function getSanitizedRoom(room, socketId) {
  const sanitizedPlayers = room.players.map(p => {
    if (p.id === socketId) {
      return p; // Return full details for own player
    }
    return {
      id: p.id,
      name: p.name,
      isReady: p.isReady,
      isHost: p.isHost,
      isBot: p.isBot,
      cardCount: p.cards ? p.cards.length : 0
      // cards list is omitted for other players
    };
  });

  const sanitizedState = room.gameState ? {
    ...room.gameState,
    deckCount: room.gameState.deck.length,
    deck: undefined, // Hide deck cards from client
    players: undefined // We will send players list separately
  } : null;

  return {
    code: room.code,
    status: room.status,
    settings: room.settings,
    players: sanitizedPlayers,
    gameState: sanitizedState
  };
}

// Broadcast updated room state to all players in a room
function broadcastRoomUpdate(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return;

  room.players.forEach(player => {
    io.to(player.id).emit('roomStateUpdate', getSanitizedRoom(room, player.id));
  });
}

// Helper to ensure deck is not empty
function ensureDeckSize(room, countNeeded) {
  const { gameState } = room;
  if (gameState.deck.length < countNeeded) {
    // Salvage discard pile except the top card
    const topCard = gameState.discardPile.pop();
    const newDeck = [...gameState.discardPile];
    // Reset wild cards back to color = 'wild'
    newDeck.forEach(c => {
      if (c.type === 'wild' || c.type === 'wild_draw') {
        c.color = 'wild';
      }
    });
    shuffle(newDeck);
    gameState.deck = [...newDeck, ...gameState.deck];
    gameState.discardPile = [topCard];
    
    console.log(`Shuffled discard pile back into deck. New deck count: ${gameState.deck.length}`);
  }
}

const BOT_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];

function startTurnTimer(room) {
  stopTurnTimer(room);

  if (!room.settings.timerDuration || room.settings.timerDuration <= 0) return;

  room.gameState.timerSeconds = room.settings.timerDuration;
  
  room.timerId = setInterval(() => {
    if (room.status !== 'playing' || !room.gameState || room.gameState.winner) {
      stopTurnTimer(room);
      return;
    }

    room.gameState.timerSeconds--;
    
    io.to(room.code).emit('timerTick', { secondsLeft: room.gameState.timerSeconds });

    if (room.gameState.timerSeconds <= 0) {
      stopTurnTimer(room);
      handleTurnTimeout(room);
    }
  }, 1000);
}

function stopTurnTimer(room) {
  if (room.timerId) {
    clearInterval(room.timerId);
    room.timerId = null;
  }
}

function handleTurnTimeout(room) {
  const { gameState } = room;
  const activePlayer = room.players[gameState.currentTurn];
  if (!activePlayer) return;

  const timeoutMsg = {
    sender: 'System',
    text: `⏰ ${activePlayer.name}'s turn timed out.`,
    timestamp: Date.now()
  };
  room.messages.push(timeoutMsg);
  io.to(room.code).emit('chatMessage', timeoutMsg);

  if (gameState.drawStack > 0) {
    const drawQty = gameState.drawStack;
    ensureDeckSize(room, drawQty);
    for (let i = 0; i < drawQty; i++) {
      activePlayer.cards.push(gameState.deck.pop());
    }
    gameState.drawStack = 0;
  } else {
    ensureDeckSize(room, 1);
    activePlayer.cards.push(gameState.deck.pop());
  }

  advanceTurn(room, 1);
  broadcastRoomUpdate(room.code);
}

function triggerBotTurn(room) {
  const { gameState } = room;
  const botPlayer = room.players[gameState.currentTurn];
  if (!botPlayer || !botPlayer.isBot) return;

  // Simulate human thinking delay (1.2 to 2.2 seconds)
  const delay = botPlayer.difficulty === 'hard' ? 1500 : 1000;
  setTimeout(() => {
    if (room.status !== 'playing' || !room.gameState || room.gameState.winner) return;
    const currentActive = room.players[room.gameState.currentTurn];
    if (!currentActive || currentActive.id !== botPlayer.id) return;

    // Check if there is a pending challenge or hand swap blocking play
    if (room.gameState.pendingChallenge || room.gameState.pendingHandSwap) return;

    executeBotTurn(room, botPlayer);
  }, delay);
}

function executeBotTurn(room, botPlayer) {
  const { gameState } = room;
  const topCard = gameState.discardPile[gameState.discardPile.length - 1];

  // 1. Stacking Penalty Play
  if (gameState.drawStack > 0 && room.settings.stackingEnabled) {
    const playableDrawCards = botPlayer.cards.filter(c => {
      if (room.settings.mixedStacking) {
        return c.type === 'draw_2' || c.type === 'wild_draw';
      } else {
        // Must match exact type (draw_2 on draw_2, wild_draw on wild_draw)
        return c.type === topCard.type;
      }
    });

    if (playableDrawCards.length > 0 && (!room.settings.stackMaxLimit || gameState.drawStack < room.settings.stackMaxLimit)) {
      // Hard bot stacks smartest card first
      const cardToPlay = playableDrawCards[0];
      playBotCard(room, botPlayer, cardToPlay);
    } else {
      // Draw penalty cards
      const drawQty = gameState.drawStack;
      ensureDeckSize(room, drawQty);
      for (let i = 0; i < drawQty; i++) {
        botPlayer.cards.push(gameState.deck.pop());
      }
      gameState.drawStack = 0;

      const penaltyMsg = {
        sender: 'System',
        text: `🤖 ${botPlayer.name} draws ${drawQty} penalty cards and skips their turn.`,
        timestamp: Date.now()
      };
      room.messages.push(penaltyMsg);
      io.to(room.code).emit('chatMessage', penaltyMsg);

      advanceTurn(room, 1);
      broadcastRoomUpdate(room.code);
    }
    return;
  }

  // 2. Standard Play Validation
  const playable = botPlayer.cards.filter(c => 
    c.color === 'wild' || c.color === gameState.activeColor || c.value === topCard.value
  );

  if (playable.length > 0) {
    let cardToPlay = null;
    const nextPlayerIndex = (gameState.currentTurn + gameState.direction + room.players.length) % room.players.length;
    const nextPlayer = room.players[nextPlayerIndex];
    const nextPlayerHasLowCards = nextPlayer && nextPlayer.cards.length <= 2;

    if (botPlayer.difficulty === 'hard') {
      // Hard Bot Strategy
      if (nextPlayerHasLowCards) {
        // Prioritize blocking action cards
        cardToPlay = playable.find(c => c.type === 'wild_draw_4' || c.type === 'wild_draw');
        if (!cardToPlay) cardToPlay = playable.find(c => c.type === 'draw_2');
        if (!cardToPlay) cardToPlay = playable.find(c => c.type === 'skip' || c.type === 'reverse');
      }

      if (!cardToPlay) {
        // Prioritize playing the color we hold the most of
        const colorCounts = { red: 0, green: 0, blue: 0, yellow: 0 };
        botPlayer.cards.forEach(c => {
          if (c.color !== 'wild') colorCounts[c.color]++;
        });
        const sortedPlayable = [...playable].sort((a, b) => {
          const scoreA = a.color === 'wild' ? 0 : colorCounts[a.color];
          const scoreB = b.color === 'wild' ? 0 : colorCounts[b.color];
          return scoreB - scoreA;
        });
        cardToPlay = sortedPlayable[0];
      }
    } else if (botPlayer.difficulty === 'medium') {
      // Medium Strategy: prioritize action cards
      cardToPlay = playable.find(c => c.type === 'wild_draw_4' || c.type === 'wild_draw' || c.type === 'draw_2');
      if (!cardToPlay) cardToPlay = playable.find(c => c.type === 'skip' || c.type === 'reverse');
      if (!cardToPlay) cardToPlay = playable[0];
    } else {
      // Easy Strategy: random play
      cardToPlay = playable[Math.floor(Math.random() * playable.length)];
    }

    playBotCard(room, botPlayer, cardToPlay);
  } else {
    // Draw card
    if (room.settings.drawUntilPlayable) {
      const drawnCards = [];
      let card = null;
      let isPlayable = false;

      while (!isPlayable) {
        ensureDeckSize(room, 1);
        card = gameState.deck.pop();
        botPlayer.cards.push(card);
        drawnCards.push(card);
        isPlayable = card.color === 'wild' || card.color === gameState.activeColor || card.value === topCard.value;
      }

      const drawMsg = {
        sender: 'System',
        text: `🤖 ${botPlayer.name} draws ${drawnCards.length} card(s) until a playable card is found.`,
        timestamp: Date.now()
      };
      room.messages.push(drawMsg);
      io.to(room.code).emit('chatMessage', drawMsg);

      setTimeout(() => {
        if (room.status !== 'playing' || !room.gameState || room.gameState.winner) return;
        playBotCard(room, botPlayer, card);
      }, 800);
    } else {
      ensureDeckSize(room, 1);
      const card = gameState.deck.pop();
      botPlayer.cards.push(card);

      const drawMsg = {
        sender: 'System',
        text: `🤖 ${botPlayer.name} draws a card.`,
        timestamp: Date.now()
      };
      room.messages.push(drawMsg);
      io.to(room.code).emit('chatMessage', drawMsg);

      const isPlayable = card.color === 'wild' || card.color === gameState.activeColor || card.value === topCard.value;
      if (isPlayable) {
        setTimeout(() => {
          if (room.status !== 'playing' || !room.gameState || room.gameState.winner) return;
          playBotCard(room, botPlayer, card);
        }, 800);
      } else {
        advanceTurn(room, 1);
        broadcastRoomUpdate(room.code);
      }
    }
  }
}

function playBotCard(room, botPlayer, card) {
  const { gameState } = room;
  const cardIndex = botPlayer.cards.findIndex(c => c.id === card.id);
  if (cardIndex === -1) return;

  botPlayer.cards.splice(cardIndex, 1);
  gameState.discardPile.push(card);

  // Pick Wild color
  if (card.color === 'wild') {
    const colorCounts = { red: 0, green: 0, blue: 0, yellow: 0 };
    botPlayer.cards.forEach(c => {
      if (c.color !== 'wild') colorCounts[c.color]++;
    });

    let chosenColor = 'red';
    let maxCount = -1;
    Object.keys(colorCounts).forEach(color => {
      if (colorCounts[color] > maxCount) {
        maxCount = colorCounts[color];
        chosenColor = color;
      }
    });
    gameState.activeColor = chosenColor;
  } else {
    gameState.activeColor = card.color;
  }

  let nextSkip = 1;
  let effectText = '';

  // 0 Rotates Hands
  if (card.value === 0 && room.settings.sevenZeroEnabled) {
    effectText = `rotating all hands`;
    const numPlayers = room.players.length;
    const tempHands = room.players.map(p => [...p.cards]);

    room.players.forEach((p, i) => {
      const sourceIndex = (i - gameState.direction + numPlayers) % numPlayers;
      p.cards = tempHands[sourceIndex];
    });

    const rotateMsg = {
      sender: 'System',
      text: `🔄 Card 0 played! All player hands rotated in the direction of play.`,
      timestamp: Date.now()
    };
    room.messages.push(rotateMsg);
    io.to(room.code).emit('chatMessage', rotateMsg);
  }

  // 7 Pending Swaps
  if (card.value === 7 && room.settings.sevenZeroEnabled) {
    gameState.pendingHandSwap = {
      playerId: botPlayer.id
    };
    effectText = `swapping hands`;
  }

  if (card.type === 'skip') {
    nextSkip = 2;
    effectText = `skipping the next player`;
  } else if (card.type === 'reverse') {
    gameState.direction *= -1;
    effectText = `reversing direction`;
    if (room.players.length === 2) {
      nextSkip = 2;
    }
  } else if (card.type === 'draw_2' || card.type === 'wild_draw') {
    const drawQty = card.drawAmount;
    if (room.settings.stackingEnabled) {
      gameState.drawStack += drawQty;
      effectText = `stacking +${drawQty} (Total: +${gameState.drawStack})`;
    } else {
      const nextIdx = (gameState.currentTurn + gameState.direction + room.players.length) % room.players.length;
      const nextP = room.players[nextIdx];
      ensureDeckSize(room, drawQty);
      for (let i = 0; i < drawQty; i++) {
        nextP.cards.push(gameState.deck.pop());
      }
      nextSkip = 2;
      effectText = `${nextP.name} draws ${drawQty} and skips turn`;
    }
  }

  // Check UNO call
  if (botPlayer.cards.length === 1) {
    let forgetsUno = false;
    if (botPlayer.difficulty === 'easy') forgetsUno = Math.random() < 0.3;
    else if (botPlayer.difficulty === 'medium') forgetsUno = Math.random() < 0.1;

    if (forgetsUno) {
      gameState.unoPendingPenalty[botPlayer.id] = true;
    } else {
      gameState.unoCalls[botPlayer.id] = true;
      const unoAlertMsg = {
        sender: 'System',
        text: `📣 🤖 ${botPlayer.name} calls UNO!`,
        timestamp: Date.now()
      };
      room.messages.push(unoAlertMsg);
      io.to(room.code).emit('chatMessage', unoAlertMsg);
    }
  } else {
    delete gameState.unoCalls[botPlayer.id];
    delete gameState.unoPendingPenalty[botPlayer.id];
  }

  // Check Win condition
  if (botPlayer.cards.length === 0) {
    gameState.winner = botPlayer.id;
    room.status = 'gameover';
    stopTurnTimer(room);

    const winMsg = {
      sender: 'System',
      text: `🎉 🤖 ${botPlayer.name} has won the game!`,
      timestamp: Date.now()
    };
    room.messages.push(winMsg);
    io.to(room.code).emit('chatMessage', winMsg);
    broadcastRoomUpdate(room.code);
    return;
  }

  // Chat message details
  const colorWord = card.color === 'wild' ? `Wild (${gameState.activeColor.toUpperCase()})` : card.color.toUpperCase();
  const playMsg = {
    sender: 'System',
    text: `🤖 ${botPlayer.name} played a ${colorWord} ${card.value}${effectText ? ` - ${effectText}` : ''}.`,
    timestamp: Date.now()
  };
  room.messages.push(playMsg);
  io.to(room.code).emit('chatMessage', playMsg);

  // Check Wild Draw 4 Challenge variants
  if (card.value === 'wild_draw_4' && !room.settings.noBluffChallenge) {
    const prevColor = gameState.discardPile[gameState.discardPile.length - 2]?.color || 'red';
    gameState.pendingChallenge = {
      challengerId: room.players[(gameState.currentTurn + gameState.direction + room.players.length) % room.players.length].id,
      playerId: botPlayer.id,
      drawAmount: 4,
      activeColorBeforePlay: prevColor,
      cardId: card.id,
      chosenColor: gameState.activeColor
    };
    broadcastRoomUpdate(room.code);

    // Trigger challenge decisions
    triggerBotChallengeDecision(room);
    return;
  }

  // Check swap conditions
  if (gameState.pendingHandSwap) {
    broadcastRoomUpdate(room.code);
    setTimeout(() => {
      let bestTarget = null;
      let minCards = 999;
      room.players.forEach(p => {
        if (p.id !== botPlayer.id && p.cards.length < minCards) {
          minCards = p.cards.length;
          bestTarget = p;
        }
      });
      if (bestTarget) {
        executeHandSwap(room, bestTarget.id);
      }
    }, 1200);
    return;
  }

  advanceTurn(room, nextSkip);
  broadcastRoomUpdate(room.code);
}

// Helper to advance the turn
function advanceTurn(room, skipCount = 1) {
  stopTurnTimer(room);

  const { currentTurn, direction, players } = room.gameState;
  const numPlayers = players.length;
  room.gameState.currentTurn = (currentTurn + (direction * skipCount) + numPlayers * Math.abs(skipCount)) % numPlayers;
  
  // Reset hasDrawn status for the new active player
  room.gameState.hasDrawn = false;
  room.gameState.drawnCardPlayable = null;

  startTurnTimer(room);
  triggerBotTurn(room);
}

// Matchmaking Queue Processing
function processMatchmakingQueue(mode, targetSize, timeoutMs) {
  const queue = matchmakingQueues[mode];
  if (!queue || queue.length === 0) return;

  const now = Date.now();

  // Try to group up to targetSize players
  while (queue.length >= targetSize) {
    const group = queue.splice(0, targetSize);
    createMatchFromGroup(group, mode);
  }

  // Check if oldest player in queue timed out
  if (queue.length > 0 && (now - queue[0].joinedTime >= timeoutMs)) {
    const groupSize = queue.length; // match whatever players are ready
    const group = queue.splice(0, groupSize);
    createMatchFromGroup(group, mode);
  }
}

function createMatchFromGroup(group, mode) {
  const roomCode = generateRoomCode();
  const roomPlayers = group.map((p, index) => ({
    id: p.socketId,
    name: p.playerName,
    isReady: true,
    isHost: index === 0,
    isBot: false,
    cards: []
  }));

  // Auto fill up to 4 players with AI bots
  const targetPlayersCount = 4;
  while (roomPlayers.length < targetPlayersCount) {
    const botId = `bot_${Math.random().toString(36).substring(2, 9)}`;
    const botName = `🤖 Bot ${BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]}`;
    roomPlayers.push({
      id: botId,
      name: botName,
      isReady: true,
      isHost: false,
      isBot: true,
      difficulty: ['easy', 'medium', 'hard'][Math.floor(Math.random() * 3)],
      cards: []
    });
  }

  const newRoom = {
    code: roomCode,
    status: 'playing',
    settings: {
      stackingEnabled: true,
      stackMaxLimit: 0,
      mixedStacking: true,
      jumpInEnabled: true,
      sevenZeroEnabled: true,
      drawUntilPlayable: false,
      noBluffChallenge: false,
      timerDuration: 30,
      spectatorsEnabled: true,
      maxPlayers: 4,
      rankedMode: mode === 'ranked'
    },
    players: roomPlayers,
    gameState: null,
    messages: []
  };

  // Setup game state deck
  let gameDeck = generateDeck();
  shuffle(gameDeck);

  roomPlayers.forEach(player => {
    player.cards = [];
    for (let i = 0; i < 7; i++) {
      player.cards.push(gameDeck.pop());
    }
  });

  let startingCard = gameDeck.pop();
  while (startingCard.type === 'wild' || startingCard.type === 'wild_draw') {
    gameDeck.unshift(startingCard);
    shuffle(gameDeck);
    startingCard = gameDeck.pop();
  }

  newRoom.gameState = {
    players: roomPlayers.map(p => ({ id: p.id, name: p.name })),
    deck: gameDeck,
    discardPile: [startingCard],
    activeColor: startingCard.color,
    currentTurn: 0,
    direction: 1,
    drawStack: 0,
    unoCalls: {},
    unoPendingPenalty: {},
    hasDrawn: false,
    drawnCardPlayable: null,
    winner: null
  };

  rooms.set(roomCode, newRoom);

  // Notify players and make their socket join room channel
  group.forEach(p => {
    const socket = io.sockets.sockets.get(p.socketId);
    if (socket) {
      socket.join(roomCode);
      socket.emit('matchFound', roomCode);
    }
  });

  // Start timer & trigger bot turn
  startTurnTimer(newRoom);
  triggerBotTurn(newRoom);

  // Broadcast initial update
  broadcastRoomUpdate(roomCode);

  console.log(`Matchmaking completed: room ${roomCode} created for mode ${mode}.`);
}

function cancelPlayerMatchmaking(socketId) {
  Object.keys(matchmakingQueues).forEach(mode => {
    matchmakingQueues[mode] = matchmakingQueues[mode].filter(p => p.socketId !== socketId);
  });
}

function executeChallengeResolution(room, action) {
  const { gameState } = room;
  const challenge = gameState.pendingChallenge;
  if (!challenge) return;

  const challenger = room.players.find(p => p.id === challenge.challengerId);
  const playerWhoPlayed = room.players.find(p => p.id === challenge.playerId);

  if (!challenger || !playerWhoPlayed) {
    gameState.pendingChallenge = null;
    broadcastRoomUpdate(room.code);
    return;
  }

  if (action === 'accept') {
    const drawQty = challenge.drawAmount;
    ensureDeckSize(room, drawQty);

    for (let i = 0; i < drawQty; i++) {
      challenger.cards.push(gameState.deck.pop());
    }

    const acceptMsg = {
      sender: 'System',
      text: `${challenger.name} accepted the Draw 4. They draw 4 cards and skip their turn.`,
      timestamp: Date.now()
    };
    room.messages.push(acceptMsg);
    io.to(room.code).emit('chatMessage', acceptMsg);

    gameState.pendingChallenge = null;
    advanceTurn(room, 2); // skip challenger
    broadcastRoomUpdate(room.code);
  } else if (action === 'challenge') {
    // Challenge validation: Check if playerWhoPlayed holds any card matching activeColorBeforePlay (excluding wildcards)
    const hasMatchingColor = playerWhoPlayed.cards.some(c => c.color === challenge.activeColorBeforePlay);

    if (hasMatchingColor) {
      // Challenge succeeds!
      ensureDeckSize(room, 4);
      for (let i = 0; i < 4; i++) {
        playerWhoPlayed.cards.push(gameState.deck.pop());
      }

      const successMsg = {
        sender: 'System',
        text: `🚨 Challenge SUCCESSFUL! ${playerWhoPlayed.name} had a ${challenge.activeColorBeforePlay.toUpperCase()} card in hand. They draw 4 penalty cards. ${challenger.name} is spared!`,
        timestamp: Date.now()
      };
      room.messages.push(successMsg);
      io.to(room.code).emit('chatMessage', successMsg);

      gameState.pendingChallenge = null;
      advanceTurn(room, 1); // challenger gets their turn normally
      broadcastRoomUpdate(room.code);
    } else {
      // Challenge fails!
      ensureDeckSize(room, 6);
      for (let i = 0; i < 6; i++) {
        challenger.cards.push(gameState.deck.pop());
      }

      const failMsg = {
        sender: 'System',
        text: `❌ Challenge FAILED! ${playerWhoPlayed.name} did not have any ${challenge.activeColorBeforePlay.toUpperCase()} cards in hand. ${challenger.name} draws 6 cards and is skipped!`,
        timestamp: Date.now()
      };
      room.messages.push(failMsg);
      io.to(room.code).emit('chatMessage', failMsg);

      gameState.pendingChallenge = null;
      advanceTurn(room, 2); // challenger draws 6 and is skipped
      broadcastRoomUpdate(room.code);
    }
  }
}

function triggerBotChallengeDecision(room) {
  const { gameState } = room;
  const challenge = gameState.pendingChallenge;
  if (!challenge) return;

  const challenger = room.players.find(p => p.id === challenge.challengerId);
  if (!challenger || !challenger.isBot) return;

  setTimeout(() => {
    if (!room.gameState || !room.gameState.pendingChallenge) return;

    let action = 'accept';
    if (challenger.difficulty === 'easy') {
      action = Math.random() < 0.1 ? 'challenge' : 'accept';
    } else if (challenger.difficulty === 'medium') {
      action = Math.random() < 0.3 ? 'challenge' : 'accept';
    } else {
      // Hard Bot: cheat check!
      const playerWhoPlayed = room.players.find(p => p.id === challenge.playerId);
      const hasMatchingColor = playerWhoPlayed ? playerWhoPlayed.cards.some(c => c.color === challenge.activeColorBeforePlay) : false;
      action = hasMatchingColor ? 'challenge' : 'accept';
    }

    executeChallengeResolution(room, action);
  }, 1200);
}

function executeHandSwap(room, targetPlayerId) {
  const { gameState } = room;
  const activePlayer = room.players[gameState.currentTurn];
  const targetPlayer = room.players.find(p => p.id === targetPlayerId);

  if (!activePlayer || !targetPlayer) {
    gameState.pendingHandSwap = null;
    broadcastRoomUpdate(room.code);
    return;
  }

  // Swap hands
  const temp = [...activePlayer.cards];
  activePlayer.cards = [...targetPlayer.cards];
  targetPlayer.cards = temp;

  const swapMsg = {
    sender: 'System',
    text: `🤝 Hand Swap! ${activePlayer.name} swapped hands with ${targetPlayer.name}.`,
    timestamp: Date.now()
  };
  room.messages.push(swapMsg);
  io.to(room.code).emit('chatMessage', swapMsg);

  gameState.pendingHandSwap = null;

  checkWinCondition(room, activePlayer);
  checkWinCondition(room, targetPlayer);

  if (room.status === 'playing') {
    advanceTurn(room, 1);
    broadcastRoomUpdate(room.code);
  }
}

function checkWinCondition(room, player) {
  if (player.cards.length === 0) {
    room.gameState.winner = player.id;
    room.status = 'gameover';
    stopTurnTimer(room);

    const winMsg = {
      sender: 'System',
      text: `🎉 ${player.name} has won the game!`,
      timestamp: Date.now()
    };
    room.messages.push(winMsg);
    io.to(room.code).emit('chatMessage', winMsg);
    broadcastRoomUpdate(room.code);
  }
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // 1. Create Room
  socket.on('createRoom', ({ playerName }) => {
    let roomCode = generateRoomCode();
    while (rooms.has(roomCode)) {
      roomCode = generateRoomCode();
    }

    const newRoom = {
      code: roomCode,
      status: 'lobby', // lobby, playing, gameover
      settings: {
        stackingEnabled: true,
        timerDuration: 30 // seconds
      },
      players: [
        {
          id: socket.id,
          name: playerName || 'Host',
          isReady: true,
          isHost: true,
          cards: []
        }
      ],
      gameState: null,
      messages: []
    };

    rooms.set(roomCode, newRoom);
    socket.join(roomCode);
    
    // Send room details back to host
    socket.emit('roomCreated', roomCode);
    broadcastRoomUpdate(roomCode);
    
    console.log(`Room created: ${roomCode} by ${playerName}`);
  });

  // Matchmaking Listeners
  socket.on('findMatch', ({ mode, playerName, rating }) => {
    cancelPlayerMatchmaking(socket.id);

    const queueItem = {
      socketId: socket.id,
      playerName: playerName || 'Player',
      joinedTime: Date.now(),
      rating: rating || 1000
    };

    if (mode === 'ranked') {
      matchmakingQueues.ranked.push(queueItem);
    } else if (mode === 'casual') {
      matchmakingQueues.casual.push(queueItem);
    } else {
      matchmakingQueues.quick.push(queueItem);
    }

    socket.emit('matchmakingStarted', { mode });
    console.log(`Player ${socket.id} entered matchmaking queue for ${mode}`);
  });

  socket.on('cancelMatchmaking', () => {
    cancelPlayerMatchmaking(socket.id);
    socket.emit('matchmakingCancelled');
    console.log(`Player ${socket.id} cancelled matchmaking`);
  });

  // Reconnect Player Listener
  socket.on('reconnectPlayer', ({ roomCode, playerName }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('errorMsg', 'Room not found.');
      return;
    }

    const offlinePlayer = room.players.find(p => p.name === playerName && p.isOffline);
    if (!offlinePlayer) {
      socket.emit('errorMsg', 'No offline player found with that name in this room.');
      return;
    }

    const oldId = offlinePlayer.id;
    offlinePlayer.id = socket.id;
    offlinePlayer.isOffline = false;
    offlinePlayer.isBot = false;

    if (room.gameState && room.gameState.players) {
      const gsPlayer = room.gameState.players.find(p => p.id === oldId);
      if (gsPlayer) {
        gsPlayer.id = socket.id;
      }
    }

    socket.join(roomCode);

    const reconnectMsg = {
      sender: 'System',
      text: `🔌 ${playerName} has reconnected and resumed control!`,
      timestamp: Date.now()
    };
    room.messages.push(reconnectMsg);
    io.to(roomCode).emit('chatMessage', reconnectMsg);

    broadcastRoomUpdate(roomCode);

    if (room.gameState && room.players[room.gameState.currentTurn].id === socket.id) {
      startTurnTimer(room);
    }
  });

  // Challenge resolution listener
  socket.on('resolveChallenge', ({ roomCode, action }) => {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState || !room.gameState.pendingChallenge) return;

    const { gameState } = room;
    const challenge = gameState.pendingChallenge;

    if (challenge.challengerId !== socket.id) {
      socket.emit('errorMsg', "You are not the player being challenged!");
      return;
    }

    executeChallengeResolution(room, action);
  });

  // Hand Swap Target selection listener
  socket.on('swapHands', ({ roomCode, targetPlayerId }) => {
    const room = rooms.get(roomCode);
    if (!room || !room.gameState || !room.gameState.pendingHandSwap) return;

    const { gameState } = room;
    if (room.players[gameState.currentTurn].id !== socket.id) return;

    executeHandSwap(room, targetPlayerId);
  });

  // Jump-In out-of-turn play listener
  socket.on('jumpIn', ({ roomCode, cardId, chosenColor }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing' || !room.settings.jumpInEnabled) return;

    const { gameState } = room;
    if (gameState.pendingChallenge || gameState.pendingHandSwap) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const cardIndex = player.cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;

    const card = player.cards[cardIndex];
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];

    // Must match color AND value exactly!
    const exactMatch = card.color === topCard.color && card.value === topCard.value;
    if (!exactMatch) {
      socket.emit('errorMsg', "Jump-in requires the exact same card (same color and value).");
      return;
    }

    // Play the card!
    player.cards.splice(cardIndex, 1);
    gameState.discardPile.push(card);
    gameState.activeColor = card.color;

    const newTurnIndex = room.players.findIndex(p => p.id === player.id);
    gameState.currentTurn = newTurnIndex;
    gameState.hasDrawn = false;
    gameState.drawnCardPlayable = null;

    let nextSkip = 1;
    let effectText = 'Jump-In! ';

    if (card.type === 'skip') {
      nextSkip = 2;
      effectText += `skipping the next player`;
    } else if (card.type === 'reverse') {
      gameState.direction *= -1;
      effectText += `reversing direction`;
      if (room.players.length === 2) nextSkip = 2;
    } else if (card.type === 'draw_2' || card.type === 'wild_draw') {
      const drawQty = card.drawAmount;
      if (room.settings.stackingEnabled) {
        gameState.drawStack += drawQty;
        effectText += `stacking +${drawQty} (Total: +${gameState.drawStack})`;
      } else {
        const nextIdx = (gameState.currentTurn + gameState.direction + room.players.length) % room.players.length;
        const nextP = room.players[nextIdx];
        ensureDeckSize(room, drawQty);
        for (let i = 0; i < drawQty; i++) {
          nextP.cards.push(gameState.deck.pop());
        }
        nextSkip = 2;
        effectText += `${nextP.name} draws ${drawQty} and skips turn`;
      }
    }

    const jumpMsg = {
      sender: 'System',
      text: `⚡ Jump-in! ${player.name} played a ${card.color.toUpperCase()} ${card.value} out of turn.`,
      timestamp: Date.now()
    };
    room.messages.push(jumpMsg);
    io.to(roomCode).emit('chatMessage', jumpMsg);

    checkWinCondition(room, player);

    if (room.status === 'playing') {
      startTurnTimer(room);
      advanceTurn(room, nextSkip);
      broadcastRoomUpdate(roomCode);
    }
  });

  // Promote Player to Host (Host-only)
  socket.on('promoteHost', ({ roomCode, playerId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const host = room.players.find(p => p.id === socket.id);
    if (!host || !host.isHost) return;

    const target = room.players.find(p => p.id === playerId);
    if (!target || target.isBot) return;

    host.isHost = false;
    target.isHost = true;

    const promoteMsg = {
      sender: 'System',
      text: `👑 ${target.name} has been promoted to Room Host.`,
      timestamp: Date.now()
    };
    room.messages.push(promoteMsg);
    io.to(roomCode).emit('chatMessage', promoteMsg);

    broadcastRoomUpdate(roomCode);
  });

  // 2. Join Room
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('errorMsg', 'Room not found.');
      return;
    }

    if (room.status !== 'lobby') {
      socket.emit('errorMsg', 'Game has already started in this room.');
      return;
    }

    if (room.players.length >= 10) {
      socket.emit('errorMsg', 'Room is full (max 10 players).');
      return;
    }

    const newPlayer = {
      id: socket.id,
      name: playerName || `Player ${room.players.length + 1}`,
      isReady: false,
      isHost: false,
      cards: []
    };

    room.players.push(newPlayer);
    socket.join(code);

    socket.emit('roomJoined', code);
    
    // Notify room of a new joiner
    const joinMsg = {
      sender: 'System',
      text: `${newPlayer.name} has joined the room.`,
      timestamp: Date.now()
    };
    room.messages.push(joinMsg);
    io.to(code).emit('chatMessage', joinMsg);

    broadcastRoomUpdate(code);
    console.log(`Player ${newPlayer.name} joined Room ${code}`);
  });

  // 3. Toggle Ready
  socket.on('toggleReady', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isReady = !player.isReady;
      broadcastRoomUpdate(roomCode);
    }
  });

  // 4. Update settings (Host only)
  socket.on('updateSettings', ({ roomCode, settings }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player && player.isHost) {
      room.settings = { ...room.settings, ...settings };
      broadcastRoomUpdate(roomCode);
      
      const updateMsg = {
        sender: 'System',
        text: `Room settings updated.`,
        timestamp: Date.now()
      };
      io.to(roomCode).emit('chatMessage', updateMsg);
    }
  });

  // 5. Start Game (Host only)
  socket.on('startGame', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const host = room.players.find(p => p.id === socket.id);
    if (!host || !host.isHost) {
      socket.emit('errorMsg', 'Only the host can start the game.');
      return;
    }

    if (room.players.length < 2) {
      socket.emit('errorMsg', 'Need at least 2 players to start.');
      return;
    }

    const allReady = room.players.every(p => p.isReady);
    if (!allReady) {
      socket.emit('errorMsg', 'All players must be ready.');
      return;
    }

    // Set up game deck
    // If many players, use a double deck
    let gameDeck = generateDeck();
    if (room.players.length > 5) {
      gameDeck = [...gameDeck, ...generateDeck()];
    }
    shuffle(gameDeck);

    // Deal 7 cards to each player
    room.players.forEach(player => {
      player.cards = [];
      for (let i = 0; i < 7; i++) {
        player.cards.push(gameDeck.pop());
      }
    });

    // Draw first card for discard pile
    let startingCard = gameDeck.pop();
    // Re-draw if it's a wild or wild-draw card
    while (startingCard.type === 'wild' || startingCard.type === 'wild_draw') {
      gameDeck.unshift(startingCard);
      shuffle(gameDeck);
      startingCard = gameDeck.pop();
    }

    room.status = 'playing';
    room.gameState = {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      deck: gameDeck,
      discardPile: [startingCard],
      activeColor: startingCard.color,
      currentTurn: 0,
      direction: 1, // 1 = clockwise, -1 = counter-clockwise
      drawStack: 0, // for stacking penalties
      unoCalls: {}, // maps player id -> boolean (called UNO successfully)
      unoPendingPenalty: {}, // maps player id -> boolean (has 1 card, did NOT call UNO yet)
      hasDrawn: false, // track if current player drew a card
      drawnCardPlayable: null, // store card that was just drawn if it's playable
      winner: null
    };

    // If starting card is a special action (Skip, Reverse, Draw 2), apply it immediately!
    const activePlayerId = room.players[0].id;
    if (startingCard.type === 'skip') {
      advanceTurn(room, 1);
    } else if (startingCard.type === 'reverse') {
      room.gameState.direction = -1;
      room.gameState.currentTurn = room.players.length - 1; // last player goes first
    } else if (startingCard.type === 'draw_2') {
      if (room.settings.stackingEnabled) {
        room.gameState.drawStack = 2;
      } else {
        // Next player immediately draws 2 and is skipped
        const victimPlayer = room.players[1];
        for (let i = 0; i < 2; i++) {
          victimPlayer.cards.push(room.gameState.deck.pop());
        }
        advanceTurn(room, 1);
      }
    }

    const startMsg = {
      sender: 'System',
      text: `The game has started! Starting card is ${startingCard.color.toUpperCase()} ${startingCard.value}.`,
      timestamp: Date.now()
    };
    room.messages.push(startMsg);
    io.to(roomCode).emit('chatMessage', startMsg);

    // Start timer & trigger bot turn for the starting player
    startTurnTimer(room);
    triggerBotTurn(room);

    broadcastRoomUpdate(roomCode);
    console.log(`Game started in room ${roomCode}`);
  });

  // 6. Play Card
  socket.on('playCard', ({ roomCode, cardId, chosenColor }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const { gameState } = room;

    // Cannot play standard cards if there is a pending challenge or hand swap blocking the game
    if (gameState.pendingChallenge || gameState.pendingHandSwap) return;

    const activePlayerIndex = gameState.currentTurn;
    const activePlayer = room.players[activePlayerIndex];

    if (activePlayer.id !== socket.id) {
      socket.emit('errorMsg', "It's not your turn!");
      return;
    }

    // Check if card is in hand
    const cardIndex = activePlayer.cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) {
      socket.emit('errorMsg', "Card not found in your hand.");
      return;
    }

    const card = activePlayer.cards[cardIndex];
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];

    // Card Match Validation
    let isPlayable = false;

    // If there is an active stacking penalty, must stack a draw card or you can't play standard cards
    if (gameState.drawStack > 0 && room.settings.stackingEnabled) {
      // Check stack limit
      if (room.settings.stackMaxLimit > 0 && gameState.drawStack >= room.settings.stackMaxLimit) {
        socket.emit('errorMsg', `The stacking limit of +${room.settings.stackMaxLimit} has been reached! You must draw.`);
        return;
      }

      if (card.type === 'draw_2' || card.type === 'wild_draw') {
        if (room.settings.mixedStacking) {
          isPlayable = true;
        } else {
          // Must match exact type
          if (card.type === topCard.type) {
            isPlayable = true;
          } else {
            socket.emit('errorMsg', `Mixed stacking is disabled. You must stack a ${topCard.type === 'draw_2' ? 'Draw 2' : 'Wild Draw'} card!`);
            return;
          }
        }
      } else {
        socket.emit('errorMsg', `You must play a Draw card or Draw ${gameState.drawStack} cards!`);
        return;
      }
    } else {
      // Standard matching rules
      if (card.color === 'wild' || card.color === gameState.activeColor || card.value === topCard.value) {
        isPlayable = true;
      }
    }

    if (!isPlayable) {
      socket.emit('errorMsg', "This card cannot be played on the top card.");
      return;
    }

    // Validation complete. Play the card!
    activePlayer.cards.splice(cardIndex, 1);
    gameState.discardPile.push(card);

    // Set active color
    if (card.color === 'wild') {
      if (!chosenColor || !['red', 'green', 'blue', 'yellow'].includes(chosenColor.toLowerCase())) {
        socket.emit('errorMsg', "Invalid color choice for Wild card.");
        activePlayer.cards.splice(cardIndex, 0, card);
        gameState.discardPile.pop();
        return;
      }
      gameState.activeColor = chosenColor.toLowerCase();
    } else {
      gameState.activeColor = card.color;
    }

    let nextSkip = 1;
    let effectText = '';

    // 0 Rotates Hands
    if (card.value === 0 && room.settings.sevenZeroEnabled) {
      effectText = `rotating all hands`;
      const numPlayers = room.players.length;
      const tempHands = room.players.map(p => [...p.cards]);

      room.players.forEach((p, i) => {
        const sourceIndex = (i - gameState.direction + numPlayers) % numPlayers;
        p.cards = tempHands[sourceIndex];
      });

      const rotateMsg = {
        sender: 'System',
        text: `🔄 Card 0 played! All player hands rotated in the direction of play.`,
        timestamp: Date.now()
      };
      room.messages.push(rotateMsg);
      io.to(roomCode).emit('chatMessage', rotateMsg);
    }

    // 7 Hand Swap Target Choosing
    if (card.value === 7 && room.settings.sevenZeroEnabled) {
      gameState.pendingHandSwap = {
        playerId: activePlayer.id
      };
      effectText = `swapping hands`;
    }

    if (card.type === 'skip') {
      nextSkip = 2;
      effectText = `skipping the next player`;
    } else if (card.type === 'reverse') {
      gameState.direction *= -1;
      effectText = `reversing direction`;
      if (room.players.length === 2) {
        nextSkip = 2;
      }
    } else if (card.type === 'draw_2' || card.type === 'wild_draw') {
      const drawQty = card.drawAmount;
      if (room.settings.stackingEnabled) {
        gameState.drawStack += drawQty;
        effectText = `stacking +${drawQty} (Total: +${gameState.drawStack})`;
      } else {
        const nextIdx = (gameState.currentTurn + gameState.direction + room.players.length) % room.players.length;
        const nextP = room.players[nextIdx];
        ensureDeckSize(room, drawQty);
        for (let i = 0; i < drawQty; i++) {
          nextP.cards.push(gameState.deck.pop());
        }
        nextSkip = 2;
        effectText = `${nextP.name} draws ${drawQty} and skips turn`;
      }
    }

    // Check UNO declarations
    if (activePlayer.cards.length === 1) {
      if (!gameState.unoCalls[activePlayer.id]) {
        gameState.unoPendingPenalty[activePlayer.id] = true;
      }
    } else {
      delete gameState.unoCalls[activePlayer.id];
      delete gameState.unoPendingPenalty[activePlayer.id];
    }

    // Check Win condition
    if (activePlayer.cards.length === 0) {
      gameState.winner = activePlayer.id;
      room.status = 'gameover';
      stopTurnTimer(room);

      const winMsg = {
        sender: 'System',
        text: `🎉 ${activePlayer.name} has won the game!`,
        timestamp: Date.now()
      };
      room.messages.push(winMsg);
      io.to(roomCode).emit('chatMessage', winMsg);
      broadcastRoomUpdate(roomCode);
      return;
    }

    // Broadcast play details in chat
    const colorWord = card.color === 'wild' ? `Wild (${gameState.activeColor.toUpperCase()})` : card.color.toUpperCase();
    const playMsg = {
      sender: 'System',
      text: `${activePlayer.name} played a ${colorWord} ${card.value}${effectText ? ` - ${effectText}` : ''}.`,
      timestamp: Date.now()
    };
    room.messages.push(playMsg);
    io.to(roomCode).emit('chatMessage', playMsg);

    // Wild Draw 4 Bluff Challenge triggers
    if (card.value === 'wild_draw_4' && !room.settings.noBluffChallenge) {
      const prevColor = gameState.discardPile[gameState.discardPile.length - 2]?.color || 'red';
      gameState.pendingChallenge = {
        challengerId: room.players[(gameState.currentTurn + gameState.direction + room.players.length) % room.players.length].id,
        playerId: activePlayer.id,
        drawAmount: 4,
        activeColorBeforePlay: prevColor,
        cardId: card.id,
        chosenColor: gameState.activeColor
      };
      broadcastRoomUpdate(roomCode);

      // Trigger bot challenge decision if challenger is a bot
      triggerBotChallengeDecision(room);
      return;
    }

    // Hand Swap locks
    if (gameState.pendingHandSwap) {
      broadcastRoomUpdate(roomCode);
      return;
    }

    advanceTurn(room, nextSkip);
    broadcastRoomUpdate(roomCode);
  });



  // 7. Draw Card
  socket.on('drawCard', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const { gameState } = room;
    const activePlayerIndex = gameState.currentTurn;
    const activePlayer = room.players[activePlayerIndex];

    if (activePlayer.id !== socket.id) {
      socket.emit('errorMsg', "It's not your turn!");
      return;
    }

    // 7a. Stacking Draw Penalty
    if (gameState.drawStack > 0) {
      const drawQty = gameState.drawStack;
      ensureDeckSize(room, drawQty);

      const drawn = [];
      for (let i = 0; i < drawQty; i++) {
        const c = gameState.deck.pop();
        activePlayer.cards.push(c);
        drawn.push(c);
      }

      gameState.drawStack = 0; // reset penalty stack

      const penaltyMsg = {
        sender: 'System',
        text: `${activePlayer.name} draws ${drawQty} penalty cards and skips their turn.`,
        timestamp: Date.now()
      };
      room.messages.push(penaltyMsg);
      io.to(roomCode).emit('chatMessage', penaltyMsg);

      // Advance turn immediately, skipping player
      advanceTurn(room, 1);
      broadcastRoomUpdate(roomCode);
      return;
    }

    // 7b. Normal Draw (Single Card) or Draw Until Playable
    if (gameState.hasDrawn) {
      socket.emit('errorMsg', "You have already drawn a card this turn. You must play it or pass.");
      return;
    }

    if (room.settings.drawUntilPlayable) {
      const drawnCards = [];
      let card = null;
      let isPlayable = false;
      const topCard = gameState.discardPile[gameState.discardPile.length - 1];

      while (!isPlayable) {
        ensureDeckSize(room, 1);
        card = gameState.deck.pop();
        activePlayer.cards.push(card);
        drawnCards.push(card);
        isPlayable = card.color === 'wild' || card.color === gameState.activeColor || card.value === topCard.value;
      }

      gameState.hasDrawn = true;
      gameState.drawnCardPlayable = card;

      const drawMsg = {
        sender: 'System',
        text: `${activePlayer.name} drew ${drawnCards.length} card(s) until a playable card was found.`,
        timestamp: Date.now()
      };
      room.messages.push(drawMsg);
      io.to(roomCode).emit('chatMessage', drawMsg);

      socket.emit('drawnCardInfo', { card, isPlayable: true });
    } else {
      ensureDeckSize(room, 1);
      const card = gameState.deck.pop();
      activePlayer.cards.push(card);
      gameState.hasDrawn = true;

      // Check if drawn card is playable
      const topCard = gameState.discardPile[gameState.discardPile.length - 1];
      const isPlayable = card.color === 'wild' || card.color === gameState.activeColor || card.value === topCard.value;

      const drawMsg = {
        sender: 'System',
        text: `${activePlayer.name} drew a card.`,
        timestamp: Date.now()
      };
      room.messages.push(drawMsg);
      io.to(roomCode).emit('chatMessage', drawMsg);

      if (isPlayable) {
        gameState.drawnCardPlayable = card;
        socket.emit('drawnCardInfo', { card, isPlayable: true });
      } else {
        socket.emit('drawnCardInfo', { card, isPlayable: false });
        
        const passMsg = {
          sender: 'System',
          text: `${activePlayer.name} has no playable moves and passes.`,
          timestamp: Date.now()
        };
        room.messages.push(passMsg);
        io.to(roomCode).emit('chatMessage', passMsg);

        advanceTurn(room, 1);
      }
    }
    broadcastRoomUpdate(roomCode);
  });

  // 8. Pass Turn (After drawing a card, if player decides not to play it)
  socket.on('passTurn', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const { gameState } = room;
    const activePlayerIndex = gameState.currentTurn;
    const activePlayer = room.players[activePlayerIndex];

    if (activePlayer.id !== socket.id) {
      socket.emit('errorMsg', "It's not your turn!");
      return;
    }

    if (!gameState.hasDrawn) {
      socket.emit('errorMsg', "You must draw a card before passing!");
      return;
    }

    const passMsg = {
      sender: 'System',
      text: `${activePlayer.name} passes their turn.`,
      timestamp: Date.now()
    };
    room.messages.push(passMsg);
    io.to(roomCode).emit('chatMessage', passMsg);

    advanceTurn(room, 1);
    broadcastRoomUpdate(roomCode);
  });

  // 9. Play Drawn Card (Specifically playing the card they just drew)
  socket.on('playDrawnCard', ({ roomCode, chosenColor }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const { gameState } = room;
    const activePlayerIndex = gameState.currentTurn;
    const activePlayer = room.players[activePlayerIndex];

    if (activePlayer.id !== socket.id) return;
    if (!gameState.drawnCardPlayable) return;

    const card = gameState.drawnCardPlayable;
    
    // Play the card (it's already in the player's hand array, so let's trigger standard playCard code)
    // Wait, the client can just emit 'playCard' with the drawn card's ID directly, but having this handler is safer.
    // Let's redirect to playCard or handle it directly here:
    
    const cardId = card.id;
    // We clear the drawn card flag
    gameState.drawnCardPlayable = null;
    gameState.hasDrawn = false;

    // Delegate to standard play card logic by triggering it manually
    socket.emit('playCardRedirect', { cardId, chosenColor });
  });

  // 10. Declare UNO
  socket.on('declareUno', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const { gameState } = room;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // Check if player has 2 cards (prior to playing) or 1 card
    if (player.cards.length <= 2) {
      gameState.unoCalls[player.id] = true;
      // Remove any pending penalty since they just called it
      delete gameState.unoPendingPenalty[player.id];

      const unoMsg = {
        sender: 'System',
        text: `📣 ${player.name} calls UNO!`,
        timestamp: Date.now()
      };
      room.messages.push(unoMsg);
      io.to(roomCode).emit('chatMessage', unoMsg);
      broadcastRoomUpdate(roomCode);
    } else {
      socket.emit('errorMsg', "You cannot call UNO with more than 2 cards!");
    }
  });

  // 11. Catch UNO (Report another player who has 1 card and did not call UNO)
  socket.on('catchUno', ({ roomCode, targetPlayerId }) => {
    const room = rooms.get(roomCode);
    if (!room || room.status !== 'playing') return;

    const { gameState } = room;
    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    const reporter = room.players.find(p => p.id === socket.id);

    if (!targetPlayer || !reporter) return;

    // If target has exactly 1 card and has not called UNO (in pending penalty state)
    if (targetPlayer.cards.length === 1 && gameState.unoPendingPenalty[targetPlayer.id]) {
      // Offender draws 2 penalty cards
      ensureDeckSize(room, 2);
      for (let i = 0; i < 2; i++) {
        targetPlayer.cards.push(gameState.deck.pop());
      }

      // Clear penalty flag
      delete gameState.unoPendingPenalty[targetPlayer.id];

      const catchMsg = {
        sender: 'System',
        text: `🚨 ${reporter.name} caught ${targetPlayer.name} not declaring UNO! ${targetPlayer.name} draws 2 penalty cards.`,
        timestamp: Date.now()
      };
      room.messages.push(catchMsg);
      io.to(roomCode).emit('chatMessage', catchMsg);
      broadcastRoomUpdate(roomCode);
    } else {
      socket.emit('errorMsg', "Target player is either safe, has called UNO, or does not have 1 card.");
    }
  });

  // 12. Send Chat Message
  socket.on('sendMessage', ({ roomCode, text }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const chatMsg = {
      sender: player.name,
      text: text.slice(0, 150), // Cap length
      timestamp: Date.now()
    };
    
    room.messages.push(chatMsg);
    io.to(roomCode).emit('chatMessage', chatMsg);
  });

  // 9b. Add Bot
  socket.on('addBot', ({ roomCode }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;

    if (room.players.length >= 10) {
      socket.emit('errorMsg', 'Room is full (max 10 players).');
      return;
    }

    const activeBotNames = room.players.filter(p => p.isBot).map(p => p.name.replace('🤖 Bot ', ''));
    const availableNames = BOT_NAMES.filter(name => !activeBotNames.includes(name));
    const chosenName = availableNames[0] || BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];

    const botPlayer = {
      id: `bot_${Math.random().toString(36).substring(2, 9)}`,
      name: `🤖 Bot ${chosenName}`,
      isReady: true,
      isHost: false,
      isBot: true,
      cards: []
    };

    room.players.push(botPlayer);

    const botJoinMsg = {
      sender: 'System',
      text: `${botPlayer.name} has entered the room.`,
      timestamp: Date.now()
    };
    room.messages.push(botJoinMsg);
    io.to(roomCode).emit('chatMessage', botJoinMsg);

    broadcastRoomUpdate(roomCode);
  });

  // 9c. Kick Player
  socket.on('kickPlayer', ({ roomCode, playerId }) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;

    const targetIndex = room.players.findIndex(p => p.id === playerId);
    if (targetIndex === -1) return;

    const targetPlayer = room.players[targetIndex];
    room.players.splice(targetIndex, 1);

    if (!targetPlayer.isBot) {
      io.to(targetPlayer.id).emit('kicked');
      const targetSocket = io.sockets.sockets.get(targetPlayer.id);
      if (targetSocket) {
        targetSocket.leave(roomCode);
      }
    }

    const kickMsg = {
      sender: 'System',
      text: `🚨 ${targetPlayer.name} has been kicked from the room.`,
      timestamp: Date.now()
    };
    room.messages.push(kickMsg);
    io.to(roomCode).emit('chatMessage', kickMsg);

    broadcastRoomUpdate(roomCode);
  });

  // 9d. Voice Signal Forwarding
  socket.on('voice-signal', ({ roomCode, targetId, signal }) => {
    io.to(targetId).emit('voice-signal', {
      senderId: socket.id,
      signal
    });
  });

  // 9e. Send Emoji
  socket.on('sendEmoji', ({ roomCode, emoji }) => {
    io.to(roomCode).emit('emojiReceived', {
      playerId: socket.id,
      emoji
    });
  });

  // 9f. Voice State Update
  socket.on('voiceStateUpdate', ({ roomCode, isMuted }) => {
    socket.to(roomCode).emit('voiceStateUpdated', {
      playerId: socket.id,
      isMuted
    });
  });

  // 13. Disconnect
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    
    // Find room the player was in
    rooms.forEach((room, roomCode) => {
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const player = room.players[playerIndex];
        
        // Remove player from room
        room.players.splice(playerIndex, 1);
        console.log(`Removed ${player.name} from Room ${roomCode}`);

        // If room is empty, delete room
        if (room.players.length === 0) {
          stopTurnTimer(room);
          rooms.delete(roomCode);
          console.log(`Deleted empty Room ${roomCode}`);
          return;
        }

        // If player was host, assign host to someone else
        if (player.isHost && room.players.length > 0) {
          room.players[0].isHost = true;
          const newHostMsg = {
            sender: 'System',
            text: `${room.players[0].name} is now the host.`,
            timestamp: Date.now()
          };
          room.messages.push(newHostMsg);
          io.to(roomCode).emit('chatMessage', newHostMsg);
        }

        // Send disconnect message
        const leaveMsg = {
          sender: 'System',
          text: `${player.name} has left the game.`,
          timestamp: Date.now()
        };
        room.messages.push(leaveMsg);
        io.to(roomCode).emit('chatMessage', leaveMsg);

        // If game was playing, and we have fewer than 2 players left, end game
        if (room.status === 'playing' && room.players.length < 2) {
          room.status = 'gameover';
          stopTurnTimer(room);
          room.gameState.winner = room.players[0].id;
          
          const endMsg = {
            sender: 'System',
            text: `Game over because not enough players remain. ${room.players[0].name} wins!`,
            timestamp: Date.now()
          };
          room.messages.push(endMsg);
          io.to(roomCode).emit('chatMessage', endMsg);
        } else if (room.status === 'playing') {
          // If it was the disconnected player's turn, advance it
          if (room.gameState.currentTurn >= room.players.length) {
            room.gameState.currentTurn = 0;
          }
          // Remove them from gameState tracking if needed
          room.gameState.players = room.players.map(p => ({ id: p.id, name: p.name }));
        }

        broadcastRoomUpdate(roomCode);
      }
    });
  });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static assets from client dist folder
app.use(express.static(path.join(__dirname, '../dist')));

// Fallback for SPA routing: send index.html
app.get('*', (req, res, next) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'), (err) => {
    if (err) {
      // In development or if not built, fail gracefully
      res.status(200).send('UNO Game Server is running. Run npm run build to compile the frontend.');
    }
  });
});

// Start listening
httpServer.listen(PORT, () => {
  console.log(`UNO Multiplayer Server running on port ${PORT}`);
});
