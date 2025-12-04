// MCTS Solver for Avengement Lite
// Determines if the game is a first player win with perfect play

const fs = require('fs');
const path = require('path');
const CACHE_FILE = path.join(__dirname, 'mcts-cache.json');

class GameNode {
    constructor(state, parent = null, moveDescription = null) {
        this.state = JSON.parse(JSON.stringify(state)); // Deep clone
        this.parent = parent;
        this.moveDescription = moveDescription;
        this.children = [];
        this.visits = 0;
        this.wins = 0;
        this.untriedMoves = null;
        
        // Proof-number search fields
        this.proofStatus = null; // null, 'proven-win', 'proven-loss', 'proven-draw'
        this.proofPlayer = null; // Which player this is proven for (1 or 2)
    }

    isFullyExpanded() {
        return this.untriedMoves !== null && this.untriedMoves.length === 0;
    }

    isTerminal() {
        return this.state.gameOver || this.state.players[1].hp <= 0 || this.state.players[2].hp <= 0;
    }

    getWinner() {
        if (this.state.players[1].hp <= 0) return 2;
        if (this.state.players[2].hp <= 0) return 1;
        return null;
    }
    
    isProven() {
        return this.proofStatus !== null;
    }
    
    isProvenWinFor(player) {
        return this.proofStatus === 'proven-win' && this.proofPlayer === player;
    }
    
    isProvenLossFor(player) {
        return this.proofStatus === 'proven-loss' && this.proofPlayer === player;
    }
}

class MCTSSolver {
    constructor(iterations = 10000, explorationConstant = Math.sqrt(2)) {
        this.iterations = iterations;
        this.explorationConstant = explorationConstant;
        this.provenNodes = 0;
        this.provenWins = 0;
        this.provenLosses = 0;
        
        // Transposition table: Map of state hash -> {proofStatus, proofPlayer, visits, wins}
        this.transpositionTable = new Map();
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }
    
    // Hash a game state for transposition table
    hashState(state) {
        // Create a canonical representation of the state
        const p1 = state.players[1];
        const p2 = state.players[2];
        
        // Format: currentPlayer|p1hp|p1ap|p1row|p1col|p1stunned|p2hp|p2ap|p2row|p2col|p2stunned
        return `${state.currentPlayer}|${p1.hp}|${p1.ap}|${p1.position.row}|${p1.position.col}|${p1.stunned?1:0}|${p2.hp}|${p2.ap}|${p2.position.row}|${p2.position.col}|${p2.stunned?1:0}`;
    }
    
    // Load transposition table from disk
    loadCache() {
        try {
            if (fs.existsSync(CACHE_FILE)) {
                const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
                this.transpositionTable = new Map(Object.entries(data.table));
                this.provenNodes = data.provenNodes || 0;
                console.log(`Loaded cache: ${this.transpositionTable.size} positions, ${this.provenNodes} proven nodes`);
                return true;
            }
        } catch (err) {
            console.error('Error loading cache:', err.message);
        }
        return false;
    }
    
    // Save transposition table to disk
    saveCache() {
        try {
            const data = {
                table: Object.fromEntries(this.transpositionTable),
                provenNodes: this.provenNodes,
                timestamp: new Date().toISOString(),
                size: this.transpositionTable.size
            };
            fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
            console.log(`\nCache saved: ${this.transpositionTable.size} positions`);
            return true;
        } catch (err) {
            console.error('Error saving cache:', err.message);
            return false;
        }
    }

    // Main MCTS search
    search(initialState) {
        // Load existing cache if available
        this.loadCache();
        
        const root = new GameNode(initialState);
        const rootHash = this.hashState(initialState);
        
        // Check if root is already cached as proven
        const cachedRoot = this.transpositionTable.get(rootHash);
        if (cachedRoot && cachedRoot.proofStatus) {
            console.log("\n*** ROOT ALREADY PROVEN IN CACHE! ***");
            console.log(`Proof status: ${cachedRoot.proofStatus} for Player ${cachedRoot.proofPlayer}`);
            root.proofStatus = cachedRoot.proofStatus;
            root.proofPlayer = cachedRoot.proofPlayer;
            return this.analyzeResults(root);
        }
        
        console.log("Starting MCTS-Solver search with proof-number tracking and transposition tables...");
        console.log(`Initial state: P1 HP=${initialState.players[1].hp}, P2 HP=${initialState.players[2].hp}`);
        
        for (let i = 0; i < this.iterations; i++) {
            // Check if root is proven
            if (root.isProven()) {
                console.log(`\n*** ROOT PROVEN at iteration ${i + 1}! ***`);
                console.log(`Proof status: ${root.proofStatus} for Player ${root.proofPlayer}`);
                break;
            }
            
            let node = root;
            
            // Selection (skip proven nodes)
            while (node.isFullyExpanded() && !node.isTerminal() && !node.isProven()) {
                node = this.selectChild(node);
                // If we selected a proven node, backpropagate and restart
                if (node.isProven()) {
                    break;
                }
            }
            
            // Check transposition table before expansion
            const nodeHash = this.hashState(node.state);
            const cached = this.transpositionTable.get(nodeHash);
            if (cached && cached.proofStatus) {
                // Use cached proof
                node.proofStatus = cached.proofStatus;
                node.proofPlayer = cached.proofPlayer;
                this.cacheHits++;
                
                // Backpropagate the cached result
                const winner = cached.proofPlayer;
                this.backpropagateWithProof(node, winner);
                
                if ((i + 1) % 1000 === 0) {
                    const hitRate = (this.cacheHits / (this.cacheHits + this.cacheMisses) * 100).toFixed(1);
                    console.log(`Iteration ${i + 1}/${this.iterations}: Root win rate = ${(root.wins / root.visits * 100).toFixed(2)}% | Proven: ${this.provenNodes} | Cache: ${this.transpositionTable.size} (${hitRate}% hit)`);
                }
                continue;
            }
            this.cacheMisses++;
            
            // Check for instant win condition (adjacent + not stunned + 4+ AP)
            if (!node.isTerminal() && !node.isProven() && this.hasInstantWin(node.state)) {
                const currentPlayer = node.state.currentPlayer;
                node.proofStatus = 'proven-win';
                node.proofPlayer = currentPlayer;
                
                // Cache instant win position
                const instantWinHash = this.hashState(node.state);
                this.transpositionTable.set(instantWinHash, {
                    proofStatus: node.proofStatus,
                    proofPlayer: node.proofPlayer
                });
                
                this.provenNodes++;
                
                // Backpropagate the proven win
                this.backpropagateWithProof(node, currentPlayer);
                
                if ((i + 1) % 1000 === 0) {
                    const hitRate = this.cacheHits + this.cacheMisses > 0 
                        ? (this.cacheHits / (this.cacheHits + this.cacheMisses) * 100).toFixed(1)
                        : '0.0';
                    const proofInfo = root.isProven() ? ` [PROVEN: ${root.proofStatus}]` : '';
                    console.log(`Iteration ${i + 1}/${this.iterations}: Root win rate = ${(root.wins / root.visits * 100).toFixed(2)}%${proofInfo} | Proven: ${this.provenNodes} | Cache: ${this.transpositionTable.size} (${hitRate}% hit)`);
                    
                    // Save cache periodically (every 10k iterations)
                    if ((i + 1) % 10000 === 0) {
                        this.saveCache();
                    }
                }
                continue;
            }
            
            // Expansion
            if (!node.isTerminal() && !node.isProven()) {
                if (node.untriedMoves === null) {
                    node.untriedMoves = this.getPossibleMoves(node.state);
                }
                
                if (node.untriedMoves.length > 0) {
                    const move = node.untriedMoves.pop();
                    const newState = this.applyMove(node.state, move);
                    const child = new GameNode(newState, node, move.description);
                    node.children.push(child);
                    node = child;
                }
            }
            
            // Check for terminal node and set proof
            if (node.isTerminal()) {
                const winner = node.getWinner();
                if (winner === 1) {
                    node.proofStatus = 'proven-win';
                    node.proofPlayer = 1;
                } else if (winner === 2) {
                    node.proofStatus = 'proven-win';
                    node.proofPlayer = 2;
                }
                
                // Cache terminal node
                const terminalHash = this.hashState(node.state);
                this.transpositionTable.set(terminalHash, {
                    proofStatus: node.proofStatus,
                    proofPlayer: node.proofPlayer
                });
            }
            
            // Simulation (only if not proven)
            let winner;
            if (node.isProven()) {
                winner = node.proofPlayer;
            } else {
                winner = this.simulate(node.state);
            }
            
            // Backpropagation with proof checking
            this.backpropagateWithProof(node, winner);
            
            if ((i + 1) % 1000 === 0) {
                const hitRate = this.cacheHits + this.cacheMisses > 0 
                    ? (this.cacheHits / (this.cacheHits + this.cacheMisses) * 100).toFixed(1)
                    : '0.0';
                const proofInfo = root.isProven() ? ` [PROVEN: ${root.proofStatus}]` : '';
                console.log(`Iteration ${i + 1}/${this.iterations}: Root win rate = ${(root.wins / root.visits * 100).toFixed(2)}%${proofInfo} | Proven: ${this.provenNodes} | Cache: ${this.transpositionTable.size} (${hitRate}% hit)`);
                
                // Save cache periodically (every 10k iterations)
                if ((i + 1) % 10000 === 0) {
                    this.saveCache();
                }
            }
        }
        
        // Save final cache
        this.saveCache();
        
        return this.analyzeResults(root);
    }

    // UCT selection
    selectChild(node) {
        let bestScore = -Infinity;
        let bestChild = null;
        
        for (const child of node.children) {
            // UCB1 formula
            const exploitation = child.wins / child.visits;
            const exploration = this.explorationConstant * Math.sqrt(Math.log(node.visits) / child.visits);
            const score = exploitation + exploration;
            
            if (score > bestScore) {
                bestScore = score;
                bestChild = child;
            }
        }
        
        return bestChild;
    }

    // Get all possible moves from current state
    getPossibleMoves(state) {
        const moves = [];
        const currentPlayer = state.players[state.currentPlayer];
        const enemyId = state.currentPlayer === 1 ? 2 : 1;
        
        // If stunned, can only end turn
        if (currentPlayer.stunned) {
            moves.push({ type: 'endTurn', description: 'End Turn (Stunned)' });
            return moves;
        }
        
        // Rest action (always available if not acted)
        moves.push({ type: 'rest', description: 'Rest (+1 HP, +1 AP)' });
        
        // Move actions (if have AP)
        if (currentPlayer.ap >= 1) {
            const validMoves = this.getValidMoves(state, currentPlayer.position);
            for (const pos of validMoves) {
                // OPTIMIZATION: Don't move back to the position we just came from
                if (state.lastPosition && 
                    state.lastPosition.row === pos.row && 
                    state.lastPosition.col === pos.col) {
                    continue; // Skip this move - it's backtracking
                }
                
                moves.push({
                    type: 'move',
                    targetRow: pos.row,
                    targetCol: pos.col,
                    description: `Move to (${pos.row},${pos.col})`
                });
            }
        }
        
        // Strike actions (if have AP and enemy adjacent)
        if (currentPlayer.ap >= 1) {
            const adjacentEnemies = this.getAdjacentEnemies(state, currentPlayer.position, enemyId);
            for (const pos of adjacentEnemies) {
                moves.push({
                    type: 'strike',
                    targetRow: pos.row,
                    targetCol: pos.col,
                    description: `Strike at (${pos.row},${pos.col})`
                });
            }
        }
        
        // Lunging Strikes (if have 3+ AP)
        if (currentPlayer.ap >= 3) {
            moves.push({
                type: 'lunging',
                description: 'Lunging Strikes (3 AP, then stunned)'
            });
        }
        
        // End turn - OPTIMIZATION: Only allow if we actually did something this turn
        // (i.e., AP changed from the start of the turn, or we're at max AP)
        // This prevents "do nothing and end turn" which is strictly worse than resting
        const didSomethingThisTurn = currentPlayer.ap !== state.turnStartAP || currentPlayer.ap >= 6;
        if (didSomethingThisTurn) {
            moves.push({ type: 'endTurn', description: 'End Turn' });
        }
        
        return moves;
    }

    // Apply a move to create new state
    applyMove(state, move) {
        const newState = JSON.parse(JSON.stringify(state));
        const player = newState.players[newState.currentPlayer];
        
        switch (move.type) {
            case 'rest':
                player.hp = Math.min(player.maxHp, player.hp + 1);
                player.ap = Math.min(6, player.ap + 1);
                // Rest ends the turn
                this.endTurn(newState);
                break;
                
            case 'move':
                // Track the position we're leaving (for backtracking prevention)
                newState.lastPosition = { row: player.position.row, col: player.position.col };
                
                newState.board[player.position.row][player.position.col] = null;
                newState.board[move.targetRow][move.targetCol] = newState.currentPlayer;
                player.position = { row: move.targetRow, col: move.targetCol };
                player.ap -= 1;
                // Move does NOT end turn - player can take more actions
                break;
                
            case 'strike':
                const enemyId = newState.currentPlayer === 1 ? 2 : 1;
                newState.players[enemyId].hp -= 2;
                player.ap -= 1;
                if (newState.players[enemyId].hp <= 0) {
                    newState.gameOver = true;
                }
                // Strike does NOT end turn - player can take more actions
                break;
                
            case 'lunging':
                this.executeLunging(newState);
                // Lunging ends the turn and stuns the player
                this.endTurn(newState);
                break;
                
            case 'endTurn':
                this.endTurn(newState);
                break;
        }
        
        return newState;
    }

    // Execute lunging strikes (simplified - no shove, random movement)
    executeLunging(state) {
        const player = state.players[state.currentPlayer];
        const enemyId = state.currentPlayer === 1 ? 2 : 1;
        player.ap -= 3;
        
        // Check if first strike hits
        let firstStrikeHit = false;
        const firstAdjacentEnemies = this.getAdjacentEnemies(state, player.position, enemyId);
        if (firstAdjacentEnemies.length > 0) {
            firstStrikeHit = true;
        }
        
        // Perform 3 combos
        for (let combo = 0; combo < 3; combo++) {
            // Deal 2 damage to all adjacent enemies
            const adjacentEnemies = this.getAdjacentEnemies(state, player.position, enemyId);
            for (const pos of adjacentEnemies) {
                state.players[enemyId].hp -= 2;
                if (state.players[enemyId].hp <= 0) {
                    state.gameOver = true;
                    return;
                }
            }
            
            // Only move after dealing damage:
            // - If first strike hit, only move on the LAST combo (combo === 2)
            // - If first strike missed, move after each strike to try to get in range
            const shouldMove = firstStrikeHit ? (combo === 2) : true;
            
            if (shouldMove) {
                const validMoves = this.getValidMoves(state, player.position);
                if (validMoves.length > 0) {
                    const randomMove = validMoves[Math.floor(Math.random() * validMoves.length)];
                    state.board[player.position.row][player.position.col] = null;
                    state.board[randomMove.row][randomMove.col] = state.currentPlayer;
                    player.position = { row: randomMove.row, col: randomMove.col };
                }
            }
        }
        
        // Stun player (will be applied when turn ends)
        player.stunned = true;
        player.stunnedThisTurn = true;
        
        // Note: Turn ending is handled in applyMove switch statement
    }

    // Get valid move positions
    getValidMoves(state, from) {
        const valid = [];
        for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
                if (state.board[row][col] === null && this.isValidMoveDistance(from, { row, col })) {
                    valid.push({ row, col });
                }
            }
        }
        return valid;
    }

    // Check if move distance is valid (1-2 squares in straight line)
    isValidMoveDistance(from, to) {
        const rowDiff = Math.abs(from.row - to.row);
        const colDiff = Math.abs(from.col - to.col);
        const distance = Math.max(rowDiff, colDiff);
        
        if (distance < 1 || distance > 2) return false;
        if (rowDiff !== 0 && colDiff !== 0 && rowDiff !== colDiff) return false;
        
        return true;
    }

    // Check if current player has an instant win
    // Win condition: Adjacent to enemy, not stunned, and 4+ AP
    // Can deal 8 damage with 4 strikes OR 6+ damage with lunging + strikes
    hasInstantWin(state) {
        const currentPlayer = state.players[state.currentPlayer];
        const enemyId = state.currentPlayer === 1 ? 2 : 1;
        const enemy = state.players[enemyId];
        
        // Must not be stunned
        if (currentPlayer.stunned) {
            return false;
        }
        
        // Case 1: Already adjacent with 4+ AP
        const adjacentEnemies = this.getAdjacentEnemies(state, currentPlayer.position, enemyId);
        if (adjacentEnemies.length > 0 && currentPlayer.ap >= 4) {
            // With 4 AP adjacent to enemy:
            // - 4 strikes = 8 damage (kills from 7 HP)
            // - 1 lunging (3 AP) + 1 strike = 8 damage minimum (6 from lunging, 2 from strike)
            return enemy.hp <= 7;
        }
        
        // Case 2: Not adjacent but have 5+ AP (can move adjacent for 1 AP, then have 4+ left)
        // On a 3x3 board, any position can reach any other position in 1-2 moves
        if (currentPlayer.ap >= 5) {
            // Check if we can move adjacent to enemy
            const validMoves = this.getValidMoves(state, currentPlayer.position);
            for (const move of validMoves) {
                const adjacentFromMove = this.getAdjacentEnemies(state, move, enemyId);
                if (adjacentFromMove.length > 0) {
                    // Can move adjacent and will have 4+ AP remaining
                    return enemy.hp <= 7;
                }
            }
        }
        
        return false;
    }

    // Get adjacent enemy positions
    getAdjacentEnemies(state, pos, enemyId) {
        const adjacent = [];
        for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
            for (let colOffset = -1; colOffset <= 1; colOffset++) {
                if (rowOffset === 0 && colOffset === 0) continue;
                
                const newRow = pos.row + rowOffset;
                const newCol = pos.col + colOffset;
                
                if (newRow >= 0 && newRow < 3 && newCol >= 0 && newCol < 3) {
                    if (state.board[newRow][newCol] === enemyId) {
                        adjacent.push({ row: newRow, col: newCol });
                    }
                }
            }
        }
        return adjacent;
    }

    // End turn logic
    endTurn(state) {
        const currentPlayer = state.players[state.currentPlayer];
        
        // Remove stun if it wasn't applied this turn
        if (currentPlayer.stunned && !currentPlayer.stunnedThisTurn) {
            currentPlayer.stunned = false;
        }
        if (currentPlayer.stunnedThisTurn) {
            currentPlayer.stunnedThisTurn = false;
        }
        
        // Gain 1 AP
        currentPlayer.ap = Math.min(6, currentPlayer.ap + 1);
        
        // Switch players
        state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
        
        // Track starting AP for the new player's turn (to detect "do nothing" turns)
        state.turnStartAP = state.players[state.currentPlayer].ap;
        
        // Clear lastPosition when turn ends (backtracking only matters within a turn)
        state.lastPosition = null;
    }

    // Simulate game to completion with random moves
    simulate(state) {
        const simState = JSON.parse(JSON.stringify(state));
        let actionCount = 0;
        const maxActions = 500; // Prevent infinite loops (multiple actions per turn now)
        
        while (!simState.gameOver && actionCount < maxActions) {
            const moves = this.getPossibleMoves(simState);
            if (moves.length === 0) break;
            
            // Choose random move (with bias towards aggressive actions)
            const move = this.chooseSimulationMove(moves, simState);
            const newState = this.applyMove(simState, move);
            Object.assign(simState, newState);
            
            // Check for winner
            if (simState.players[1].hp <= 0) return 2;
            if (simState.players[2].hp <= 0) return 1;
            
            actionCount++;
        }
        
        // If no winner after max actions, consider it a draw (both lose)
        if (actionCount >= maxActions) {
            return 0;
        }
        
        return simState.players[1].hp > simState.players[2].hp ? 1 : 2;
    }

    // Choose move during simulation (with some strategy)
    chooseSimulationMove(moves, state) {
        const player = state.players[state.currentPlayer];
        
        // Prioritize strikes if available
        const strikes = moves.filter(m => m.type === 'strike');
        if (strikes.length > 0 && Math.random() < 0.7) {
            return strikes[Math.floor(Math.random() * strikes.length)];
        }
        
        // Sometimes use lunging if available and have good AP
        const lunging = moves.filter(m => m.type === 'lunging');
        if (lunging.length > 0 && player.ap >= 4 && Math.random() < 0.3) {
            return lunging[0];
        }
        
        // Consider ending turn if low on AP or no good moves available
        const endTurnMoves = moves.filter(m => m.type === 'endTurn');
        if (player.ap === 0 || (player.ap === 1 && strikes.length === 0 && Math.random() < 0.6)) {
            if (endTurnMoves.length > 0) {
                return endTurnMoves[0];
            }
        }
        
        // Filter out endTurn for now, prefer actions
        const actionMoves = moves.filter(m => m.type !== 'endTurn');
        if (actionMoves.length > 0 && Math.random() < 0.7) {
            return actionMoves[Math.floor(Math.random() * actionMoves.length)];
        }
        
        // Random move (including endTurn)
        return moves[Math.floor(Math.random() * moves.length)];
    }

    // Backpropagate results
    backpropagate(node, winner) {
        while (node !== null) {
            node.visits++;
            // From perspective of player 1
            if (winner === 1) {
                node.wins++;
            }
            node = node.parent;
        }
    }
    
    // Backpropagate with proof-number checking
    backpropagateWithProof(node, winner) {
        // Standard backpropagation
        this.backpropagate(node, winner);
        
        // Check for proofs bottom-up
        let current = node;
        while (current !== null) {
            if (!current.isProven() && current.isFullyExpanded()) {
                this.checkAndSetProof(current);
            }
            current = current.parent;
        }
    }
    
    // Check if a node can be proven based on its children
    checkAndSetProof(node) {
        if (node.children.length === 0 || node.isProven()) {
            return;
        }
        
        const currentPlayer = node.state.currentPlayer;
        
        // A position is a proven win for current player if ANY child is a proven win for them
        // (because current player chooses the move)
        let hasProvenWin = false;
        let allProvenLoss = true;
        
        for (const child of node.children) {
            if (child.isProvenWinFor(currentPlayer)) {
                hasProvenWin = true;
                break;
            }
            if (!child.isProvenLossFor(currentPlayer)) {
                allProvenLoss = false;
            }
        }
        
        if (hasProvenWin) {
            node.proofStatus = 'proven-win';
            node.proofPlayer = currentPlayer;
            this.provenNodes++;
            this.provenWins++;
            
            // Cache this proven position
            const hash = this.hashState(node.state);
            this.transpositionTable.set(hash, {
                proofStatus: node.proofStatus,
                proofPlayer: node.proofPlayer
            });
            return;
        }
        
        // A position is a proven loss for current player if ALL children are proven losses
        // (because opponent will choose the best response)
        if (allProvenLoss && node.children.length > 0) {
            node.proofStatus = 'proven-loss';
            node.proofPlayer = currentPlayer;
            this.provenNodes++;
            this.provenLosses++;
            
            // Cache this proven position
            const hash = this.hashState(node.state);
            this.transpositionTable.set(hash, {
                proofStatus: node.proofStatus,
                proofPlayer: node.proofPlayer
            });
            return;
        }
    }

    // Analyze results
    analyzeResults(root) {
        console.log("\n=== MCTS-Solver Analysis Complete ===");
        console.log(`Total simulations: ${root.visits}`);
        console.log(`Total proven nodes: ${this.provenNodes}`);
        console.log(`Transposition table size: ${this.transpositionTable.size}`);
        const hitRate = this.cacheHits + this.cacheMisses > 0 
            ? (this.cacheHits / (this.cacheHits + this.cacheMisses) * 100).toFixed(1)
            : '0.0';
        console.log(`Cache hit rate: ${hitRate}% (${this.cacheHits} hits, ${this.cacheMisses} misses)`);
        console.log(`Player 1 wins: ${root.wins} (${(root.wins / root.visits * 100).toFixed(2)}%)`);
        console.log(`Player 2 wins: ${root.visits - root.wins} (${((root.visits - root.wins) / root.visits * 100).toFixed(2)}%)`);
        
        const winRate = root.wins / root.visits;
        
        // Check if root is proven
        if (root.isProven()) {
            console.log("\n*** GAME SOLVED! ***");
            if (root.isProvenWinFor(1)) {
                console.log("Player 1 has a PROVEN WIN with perfect play!");
            } else if (root.isProvenWinFor(2)) {
                console.log("Player 2 has a PROVEN WIN with perfect play!");
            } else if (root.proofStatus === 'proven-loss') {
                console.log(`Player ${root.proofPlayer} has a PROVEN LOSS (opponent wins)!`);
            }
        }
        
        console.log("\nBest moves for Player 1:");
        const sortedChildren = [...root.children].sort((a, b) => {
            // Prioritize proven wins
            if (a.isProvenWinFor(1) && !b.isProvenWinFor(1)) return -1;
            if (!a.isProvenWinFor(1) && b.isProvenWinFor(1)) return 1;
            
            // Then sort by win rate
            const aRate = a.wins / a.visits;
            const bRate = b.wins / b.visits;
            return bRate - aRate;
        });
        
        for (let i = 0; i < Math.min(5, sortedChildren.length); i++) {
            const child = sortedChildren[i];
            const proofStr = child.isProven() ? ` [${child.proofStatus.toUpperCase()}]` : '';
            console.log(`  ${child.moveDescription}: ${(child.wins / child.visits * 100).toFixed(2)}% win rate (${child.visits} visits)${proofStr}`);
        }
        
        console.log("\n=== Conclusion ===");
        if (root.isProven()) {
            if (root.isProvenWinFor(1)) {
                console.log("PROVEN: Player 1 wins with optimal play!");
            } else if (root.isProvenWinFor(2)) {
                console.log("PROVEN: Player 2 wins with optimal play!");
            } else {
                console.log(`PROVEN: Player ${root.proofPlayer} loses with optimal play!`);
            }
        } else if (winRate > 0.55) {
            console.log(`Player 1 has advantage (${(winRate * 100).toFixed(2)}% win rate) - NOT YET PROVEN`);
        } else if (winRate < 0.45) {
            console.log(`Player 2 has advantage (${((1 - winRate) * 100).toFixed(2)}% win rate) - NOT YET PROVEN`);
        } else {
            console.log(`Game appears balanced (${(winRate * 100).toFixed(2)}% / ${((1 - winRate) * 100).toFixed(2)}%) - NOT YET PROVEN`);
        }
        
        return {
            winRate,
            totalSimulations: root.visits,
            player1Wins: root.wins,
            player2Wins: root.visits - root.wins,
            bestMove: sortedChildren[0]?.moveDescription,
            isProven: root.isProven(),
            proofStatus: root.proofStatus,
            proofPlayer: root.proofPlayer,
            provenNodes: this.provenNodes
        };
    }
}

// Run MCTS analysis
function analyzeGame(iterationsPerRun = 1000000) {
    // Initial game state
    const initialState = {
        board: Array(3).fill(null).map(() => Array(3).fill(null)),
        players: {
            1: { hp: 7, maxHp: 7, ap: 0, position: { row: 0, col: 1 }, stunned: false, stunnedThisTurn: false },
            2: { hp: 7, maxHp: 7, ap: 0, position: { row: 2, col: 1 }, stunned: false, stunnedThisTurn: false }
        },
        currentPlayer: 1,
        gameOver: false,
        turnStartAP: 0, // Track AP at start of turn to detect "do nothing" turns
        lastPosition: null // Track previous position to prevent immediate backtracking
    };
    
    // Place players on board
    initialState.board[0][1] = 1;
    initialState.board[2][1] = 2;
    
    // Run MCTS
    const solver = new MCTSSolver(iterationsPerRun);
    const results = solver.search(initialState);
    
    return results;
}

// Run MCTS analysis in a loop until proven
function solveUntilProven(iterationsPerRun = 500000000, maxRuns = 1) {
    console.log("=== Starting continuous solver ===");
    console.log(`Will run ${iterationsPerRun.toLocaleString()} iterations per batch`);
    console.log(`Maximum ${maxRuns} batches (press Ctrl+C to stop early)\n`);
    
    const startTime = Date.now();
    let totalIterations = 0;
    let runCount = 0;
    
    for (let i = 0; i < maxRuns; i++) {
        runCount++;
        console.log(`\n--- Batch ${runCount} ---`);
        
        const batchStart = Date.now();
        const results = analyzeGame(iterationsPerRun);
        const batchTime = ((Date.now() - batchStart) / 1000).toFixed(1);
        
        totalIterations += results.totalSimulations;
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const iterPerSec = (totalIterations / (Date.now() - startTime) * 1000).toFixed(0);
        
        console.log(`Batch completed in ${batchTime}s | Total: ${totalIterations.toLocaleString()} iterations in ${totalTime}s (${iterPerSec}/sec)`);
        
        if (results.isProven) {
            console.log("\n" + "=".repeat(60));
            console.log("🎉 GAME SOLVED! 🎉");
            console.log("=".repeat(60));
            console.log(`Total batches: ${runCount}`);
            console.log(`Total iterations: ${totalIterations.toLocaleString()}`);
            console.log(`Total time: ${totalTime}s`);
            console.log(`Proven nodes: ${results.provenNodes}`);
            
            if (results.proofStatus === 'proven-win' && results.proofPlayer === 1) {
                console.log("\n✅ PROVEN: Player 1 wins with perfect play!");
            } else if (results.proofStatus === 'proven-win' && results.proofPlayer === 2) {
                console.log("\n✅ PROVEN: Player 2 wins with perfect play!");
            }
            
            return results;
        }
        
        console.log(`Progress: ${results.provenNodes} proven nodes, ${results.winRate.toFixed(4)} win rate`);
    }
    
    console.log(`\n⚠️  Reached maximum ${maxRuns} batches without proof`);
    console.log(`Consider running again or increasing iterations per batch`);
}

// Export for use in Node.js or browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MCTSSolver, analyzeGame, solveUntilProven };
}

// Auto-run if executed directly
if (typeof window !== 'undefined') {
    console.log("MCTS Solver loaded. Call analyzeGame() or solveUntilProven() to run analysis.");
} else if (require.main === module) {
    // Run continuous solver by default
    solveUntilProven();
}
