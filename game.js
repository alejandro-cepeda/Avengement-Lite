// Game State
const gameState = {
    board: Array(3).fill(null).map(() => Array(3).fill(null)),
    players: {
        1: { hp: 7, maxHp: 7, ap: 0, position: { row: 0, col: 1 }, stunned: false, stunnedThisTurn: false },
        2: { hp: 7, maxHp: 7, ap: 0, position: { row: 2, col: 1 }, stunned: false, stunnedThisTurn: false }
    },
    currentPlayer: 1,
    currentAction: null,
    selectedCell: null,
    lungingStrikesState: null, // For tracking lunging strikes progress
    pendingShove: null, // For tracking shove target after damage
    hasActedThisTurn: false, // Track if any action taken this turn
    hasRestedThisTurn: false, // Track if player has rested this turn
    gameOver: false
};

// Initialize the game
function initGame() {
    createBoard();
    placeInitialFighters();
    updateUI();
    setupEventListeners();
    logMessage('Game started! Player 1 begins.', 'action');
}

// Create the 3x3 board
function createBoard() {
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = '';
    
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = row;
            cell.dataset.col = col;
            cell.dataset.coords = `${row},${col}`;
            cell.addEventListener('click', () => handleCellClick(row, col));
            boardElement.appendChild(cell);
        }
    }
}

// Place fighters at starting positions
function placeInitialFighters() {
    gameState.board[0][1] = 1; // Player 1 at top middle
    gameState.board[2][1] = 2; // Player 2 at bottom middle
}

// Update UI elements
function updateUI() {
    updateBoard();
    updatePlayerStats();
    updateActionButtons();
    updateTurnIndicator();
}

// Update board display
function updateBoard() {
    const cells = document.querySelectorAll('.cell');
    cells.forEach(cell => {
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        const player = gameState.board[row][col];
        
        // Clear all state classes
        cell.className = 'cell';
        cell.textContent = '';
        
        // Add player classes
        if (player === 1) {
            cell.classList.add('player1');
            cell.textContent = '⚔️';
        } else if (player === 2) {
            cell.classList.add('player2');
            cell.textContent = '⚔️';
        }
        
        // Highlight selected cell
        if (gameState.selectedCell && 
            gameState.selectedCell.row === row && 
            gameState.selectedCell.col === col) {
            cell.classList.add('selected');
        }
    });
}

// Update player stats display
function updatePlayerStats() {
    for (let player of [1, 2]) {
        const stats = gameState.players[player];
        document.getElementById(`p${player}-hp`).textContent = stats.hp;
        document.getElementById(`p${player}-ap`).textContent = stats.ap;
        
        const statusDiv = document.getElementById(`p${player}-status`);
        if (stats.stunned) {
            statusDiv.textContent = 'Stunned (Cannot act next turn)';
            statusDiv.className = 'status-indicator stunned';
        } else {
            statusDiv.textContent = '';
            statusDiv.className = 'status-indicator';
        }
        
        const panel = document.querySelector(`.player${player}-panel`);
        if (player === gameState.currentPlayer) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    }
}

// Update action buttons
function updateActionButtons() {
    const currentPlayerStats = gameState.players[gameState.currentPlayer];
    const isStunned = currentPlayerStats.stunned;
    const hasValidStrikeTarget = checkForValidStrikeTarget();
    
    document.getElementById('rest-btn').disabled = gameState.currentAction !== null || isStunned || gameState.hasActedThisTurn;
    document.getElementById('move-btn').disabled = currentPlayerStats.ap < 1 || gameState.currentAction !== null || isStunned || gameState.hasRestedThisTurn;
    document.getElementById('strike-btn').disabled = currentPlayerStats.ap < 1 || gameState.currentAction !== null || isStunned || gameState.hasRestedThisTurn || !hasValidStrikeTarget;
    document.getElementById('lunging-btn').disabled = currentPlayerStats.ap < 3 || gameState.currentAction !== null || isStunned || gameState.hasRestedThisTurn;
    
    // Remove active class from all buttons
    document.querySelectorAll('.action-btn[data-action]').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Add active class to current action button
    if (gameState.currentAction) {
        const activeBtn = document.querySelector(`[data-action="${gameState.currentAction}"]`);
        if (activeBtn) activeBtn.classList.add('active');
    }
}

// Update turn indicator
function updateTurnIndicator() {
    document.getElementById('current-turn').textContent = `Player ${gameState.currentPlayer}'s Turn`;
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('rest-btn').addEventListener('click', () => selectAction('rest'));
    document.getElementById('move-btn').addEventListener('click', () => selectAction('move'));
    document.getElementById('strike-btn').addEventListener('click', () => selectAction('strike'));
    document.getElementById('lunging-btn').addEventListener('click', () => selectAction('lunging'));
    document.getElementById('end-turn-btn').addEventListener('click', endTurn);
    document.getElementById('restart-btn').addEventListener('click', restartGame);
}

// Select an action
function selectAction(action) {
    if (gameState.currentAction === action) {
        // Deselect
        gameState.currentAction = null;
        gameState.selectedCell = null;
        showMessage('Action cancelled', 'info');
    } else {
        gameState.currentAction = action;
        gameState.selectedCell = null;
        
        if (action === 'rest') {
            executeRest();
        } else if (action === 'lunging') {
            executeLungingStrikes();
        } else {
            showMessage(`Select a target for ${action}`, 'info');
        }
    }
    
    updateUI();
}

// Handle cell clicks
function handleCellClick(row, col) {
    const clickedPlayer = gameState.board[row][col];
    
    // If no action selected, select your own fighter
    if (!gameState.currentAction) {
        if (clickedPlayer === gameState.currentPlayer) {
            gameState.selectedCell = { row, col };
            updateUI();
        }
        return;
    }
    
    // Handle actions
    switch (gameState.currentAction) {
        case 'move':
            executeMove(row, col);
            break;
        case 'strike':
            executeStrike(row, col);
            break;
        case 'strength':
            executeShove(row, col);
            break;
    }
}

// Execute Rest action
function executeRest() {
    const player = gameState.players[gameState.currentPlayer];
    
    // Gain 1 HP (capped at max)
    const hpGained = Math.min(1, player.maxHp - player.hp);
    player.hp += hpGained;
    
    // Gain 1 AP (capped at 6)
    player.ap = Math.min(6, player.ap + 1);
    
    // Mark that player has rested this turn
    gameState.hasRestedThisTurn = true;
    gameState.hasActedThisTurn = true;
    
    logMessage(`Player ${gameState.currentPlayer} rests: +${hpGained} HP, +1 AP`, 'heal');
    
    // Rest ends the turn
    gameState.currentAction = null;
    endTurn();
}

// Execute Move action
function executeMove(targetRow, targetCol) {
    const player = gameState.players[gameState.currentPlayer];
    const currentPos = player.position;
    
    // Check if target is valid (adjacent, 1-2 squares away, and empty)
    if (!isValidMove(currentPos, { row: targetRow, col: targetCol })) {
        showMessage('Invalid move! Must be 1-2 adjacent squares.', 'error');
        return;
    }
    
    // Check if square is empty
    if (gameState.board[targetRow][targetCol] !== null) {
        showMessage('Square is occupied!', 'error');
        return;
    }
    
    // Execute move
    gameState.board[currentPos.row][currentPos.col] = null;
    gameState.board[targetRow][targetCol] = gameState.currentPlayer;
    player.position = { row: targetRow, col: targetCol };
    player.ap -= 1;
    
    // Mark that an action has been taken
    gameState.hasActedThisTurn = true;
    
    logMessage(`Player ${gameState.currentPlayer} moves to (${targetRow}, ${targetCol})`, 'action');
    
    gameState.currentAction = null;
    gameState.selectedCell = null;
    updateUI();
}

// Check if move is valid (1-2 adjacent squares)
function isValidMove(from, to) {
    const rowDiff = Math.abs(from.row - to.row);
    const colDiff = Math.abs(from.col - to.col);
    const distance = Math.max(rowDiff, colDiff);
    
    // Must be 1 or 2 squares away
    if (distance < 1 || distance > 2) {
        return false;
    }
    
    // Must move in a straight line (horizontal, vertical, or diagonal)
    // This means either rowDiff is 0, colDiff is 0, or rowDiff === colDiff
    if (rowDiff !== 0 && colDiff !== 0 && rowDiff !== colDiff) {
        return false; // Not a straight line (e.g., knight move)
    }
    
    return true;
}

// Execute Strike action
function executeStrike(targetRow, targetCol) {
    const player = gameState.players[gameState.currentPlayer];
    const currentPos = player.position;
    
    // Check if target is adjacent
    if (!isAdjacent(currentPos, { row: targetRow, col: targetCol })) {
        showMessage('Target must be adjacent!', 'error');
        return;
    }
    
    // Check if target has enemy
    const targetPlayer = gameState.board[targetRow][targetCol];
    const enemyId = gameState.currentPlayer === 1 ? 2 : 1;
    
    if (targetPlayer !== enemyId) {
        showMessage('No enemy at target location!', 'error');
        return;
    }
    
    // Deal damage
    dealDamage(enemyId, 2, { row: targetRow, col: targetCol });
    player.ap -= 1;
    
    // Mark that an action has been taken
    gameState.hasActedThisTurn = true;
    
    logMessage(`Player ${gameState.currentPlayer} strikes for 2 damage!`, 'damage');
    
    // Check if player has AP for Strength ability
    if (player.ap >= 1) {
        gameState.pendingShove = { target: enemyId, fromRow: targetRow, fromCol: targetCol };
        gameState.currentAction = 'strength';
        showMessage('Shove target? (1 AP) Click adjacent square or click yourself to skip', 'info');
        updateUI();
        return;
    }
    
    gameState.currentAction = null;
    gameState.selectedCell = null;
    updateUI();
}

// Execute Shove (Strength ability)
function executeShove(targetRow, targetCol) {
    if (!gameState.pendingShove) {
        // If clicking strength button to skip
        gameState.pendingShove = null;
        gameState.currentAction = null;
        showMessage('Shove skipped', 'info');
        updateUI();
        return;
    }
    
    const { target, fromRow, fromCol } = gameState.pendingShove;
    const currentPlayer = gameState.players[gameState.currentPlayer];
    const isLungingStrikes = gameState.lungingStrikesState !== null;
    
    // Check if clicking on yourself to skip
    if (targetRow === currentPlayer.position.row && targetCol === currentPlayer.position.col) {
        gameState.pendingShove = null;
        gameState.currentAction = null;
        showMessage('Shove skipped', 'info');
        
        // If during lunging strikes, advance to next shove or move
        if (isLungingStrikes) {
            gameState.lungingStrikesState.currentShoveIndex++;
            promptLungingShove();
        } else {
            updateUI();
        }
        return;
    }
    
    // Check if target square is adjacent to enemy's current position
    if (!isAdjacent({ row: fromRow, col: fromCol }, { row: targetRow, col: targetCol })) {
        showMessage('Shove target must be adjacent to enemy!', 'error');
        return;
    }
    
    // Check if target square is empty
    if (gameState.board[targetRow][targetCol] !== null) {
        showMessage('Cannot shove to occupied square!', 'error');
        return;
    }
    
    // Execute shove
    gameState.board[fromRow][fromCol] = null;
    gameState.board[targetRow][targetCol] = target;
    gameState.players[target].position = { row: targetRow, col: targetCol };
    gameState.players[gameState.currentPlayer].ap -= 1;
    
    logMessage(`Player ${gameState.currentPlayer} shoves enemy to (${targetRow}, ${targetCol})`, 'action');
    
    gameState.pendingShove = null;
    gameState.currentAction = null;
    gameState.selectedCell = null;
    
    // If during lunging strikes, advance to next shove or move
    if (isLungingStrikes) {
        gameState.lungingStrikesState.currentShoveIndex++;
        promptLungingShove();
    } else {
        updateUI();
    }
}

// Execute Lunging Strikes
function executeLungingStrikes() {
    const player = gameState.players[gameState.currentPlayer];
    
    // Initialize lunging strikes state
    gameState.lungingStrikesState = {
        phase: 0, // 0, 1, 2 for three combos
        waitingForMove: false,
        pendingShoves: [], // Track shoves for this combo
        currentShoveIndex: 0
    };
    
    player.ap -= 3;
    
    // Mark that an action has been taken
    gameState.hasActedThisTurn = true;
    
    performLungingCombo();
}

// Perform one combo of Lunging Strikes
function performLungingCombo() {
    const state = gameState.lungingStrikesState;
    const player = gameState.players[gameState.currentPlayer];
    const currentPos = player.position;
    const enemyId = gameState.currentPlayer === 1 ? 2 : 1;
    
    logMessage(`Player ${gameState.currentPlayer} performs Lunging Strike combo ${state.phase + 1}/3`, 'action');
    
    // Deal 2 damage to all adjacent squares
    const adjacentPositions = getAdjacentPositions(currentPos);
    let hitEnemy = false;
    state.pendingShoves = []; // Reset pending shoves for this combo
    state.currentShoveIndex = 0;
    
    for (let pos of adjacentPositions) {
        const targetPlayer = gameState.board[pos.row][pos.col];
        if (targetPlayer === enemyId) {
            dealDamage(enemyId, 2, pos);
            hitEnemy = true;
            
            // Track this hit for potential shove
            if (player.ap >= 1) {
                state.pendingShoves.push({ target: enemyId, fromRow: pos.row, fromCol: pos.col });
            }
            
            // Add animation
            const cell = document.querySelector(`[data-row="${pos.row}"][data-col="${pos.col}"]`);
            cell.classList.add('lunging-animation');
            setTimeout(() => cell.classList.remove('lunging-animation'), 400);
        }
    }
    
    if (!hitEnemy) {
        logMessage(`  No enemies adjacent - no damage dealt`, 'action');
    }
    
    if (gameState.gameOver) {
        return; // Game ended due to damage
    }
    
    // Check if we have pending shoves
    if (state.pendingShoves.length > 0) {
        promptLungingShove();
    } else {
        // No shoves available, proceed to move
        promptLungingMove();
    }
}

// Prompt for shove during lunging strikes
function promptLungingShove() {
    const state = gameState.lungingStrikesState;
    const player = gameState.players[gameState.currentPlayer];
    
    if (state.currentShoveIndex >= state.pendingShoves.length) {
        // All shoves resolved, proceed to move
        promptLungingMove();
        return;
    }
    
    const shove = state.pendingShoves[state.currentShoveIndex];
    gameState.pendingShove = shove;
    gameState.currentAction = 'strength';
    
    showMessage(`Shove target? (1 AP) Click adjacent square or click yourself to skip (${state.currentShoveIndex + 1}/${state.pendingShoves.length})`, 'info');
    updateUI();
}

// Proceed to movement prompt for lunging strikes
function promptLungingMove() {
    const state = gameState.lungingStrikesState;
    const player = gameState.players[gameState.currentPlayer];
    
    // Wait for move input
    state.waitingForMove = true;
    showMessage(`Lunging Strike ${state.phase + 1}/3 - Click to move (or same square to stay)`, 'info');
    
    // Highlight valid moves
    highlightValidMoves(player.position);
}

// Highlight valid moves for lunging strikes
function highlightValidMoves(from) {
    const cells = document.querySelectorAll('.cell');
    cells.forEach(cell => {
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        
        if (isValidMove(from, { row, col }) && gameState.board[row][col] === null) {
            cell.classList.add('valid-move');
        } else if (row === from.row && col === from.col) {
            cell.classList.add('valid-move'); // Can stay in place
        }
    });
    
    // Override click handler temporarily
    cells.forEach(cell => {
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        
        cell.onclick = () => handleLungingMove(row, col);
    });
}

// Handle move during lunging strikes
function handleLungingMove(targetRow, targetCol) {
    const state = gameState.lungingStrikesState;
    if (!state || !state.waitingForMove) return;
    
    const player = gameState.players[gameState.currentPlayer];
    const currentPos = player.position;
    
    // Check if it's a valid move or staying in place
    const isSameSquare = targetRow === currentPos.row && targetCol === currentPos.col;
    const isValid = isSameSquare || (isValidMove(currentPos, { row: targetRow, col: targetCol }) && 
                                      gameState.board[targetRow][targetCol] === null);
    
    if (!isValid) {
        showMessage('Invalid move! Must be 1-2 adjacent squares or stay in place.', 'error');
        return;
    }
    
    // Execute move (or stay)
    if (!isSameSquare) {
        gameState.board[currentPos.row][currentPos.col] = null;
        gameState.board[targetRow][targetCol] = gameState.currentPlayer;
        player.position = { row: targetRow, col: targetCol };
        logMessage(`  Moved to (${targetRow}, ${targetCol})`, 'action');
    } else {
        logMessage(`  Stayed at (${targetRow}, ${targetCol})`, 'action');
    }
    
    // Clear move highlights and restore normal click handlers
    document.querySelectorAll('.cell').forEach(cell => {
        cell.classList.remove('valid-move');
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);
        cell.onclick = () => handleCellClick(row, col);
    });
    
    state.waitingForMove = false;
    state.phase++;
    
    // Check if more combos remain
    if (state.phase < 3) {
        setTimeout(() => performLungingCombo(), 500);
    } else {
        // Lunging Strikes complete - stun player
        player.stunned = true;
        player.stunnedThisTurn = true;
        logMessage(`Player ${gameState.currentPlayer} is stunned until end of next turn!`, 'action');
        gameState.lungingStrikesState = null;
        gameState.currentAction = null;
        updateUI();
    }
    
    updateUI();
}

// Deal damage to a player
function dealDamage(playerId, amount, position) {
    const player = gameState.players[playerId];
    player.hp = Math.max(0, player.hp - amount);
    
    // Add damage animation
    if (position) {
        const cell = document.querySelector(`[data-row="${position.row}"][data-col="${position.col}"]`);
        cell.classList.add('damage-animation');
        setTimeout(() => cell.classList.remove('damage-animation'), 300);
    }
    
    updateUI();
    
    // Check for game over
    if (player.hp <= 0) {
        endGame(gameState.currentPlayer);
    }
}

// Check if two positions are adjacent
function isAdjacent(pos1, pos2) {
    const rowDiff = Math.abs(pos1.row - pos2.row);
    const colDiff = Math.abs(pos1.col - pos2.col);
    return rowDiff <= 1 && colDiff <= 1 && (rowDiff + colDiff) > 0;
}

// Check if there's a valid target to strike
function checkForValidStrikeTarget() {
    const currentPlayer = gameState.players[gameState.currentPlayer];
    const currentPos = currentPlayer.position;
    const enemyId = gameState.currentPlayer === 1 ? 2 : 1;
    
    // Get all adjacent positions
    const adjacentPositions = getAdjacentPositions(currentPos);
    
    // Check if any adjacent position has the enemy
    for (let pos of adjacentPositions) {
        if (gameState.board[pos.row][pos.col] === enemyId) {
            return true;
        }
    }
    
    return false;
}

// Get all adjacent positions
function getAdjacentPositions(pos) {
    const adjacent = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
        for (let colOffset = -1; colOffset <= 1; colOffset++) {
            if (rowOffset === 0 && colOffset === 0) continue;
            
            const newRow = pos.row + rowOffset;
            const newCol = pos.col + colOffset;
            
            if (newRow >= 0 && newRow < 3 && newCol >= 0 && newCol < 3) {
                adjacent.push({ row: newRow, col: newCol });
            }
        }
    }
    return adjacent;
}

// End current turn
function endTurn() {
    if (gameState.lungingStrikesState && gameState.lungingStrikesState.waitingForMove) {
        showMessage('Complete Lunging Strikes move first!', 'error');
        return;
    }
    
    if (gameState.pendingShove) {
        showMessage('Complete or skip Strength shove first!', 'error');
        return;
    }
    
    const currentPlayerObj = gameState.players[gameState.currentPlayer];
    
    // Check if current player is stunned - only remove if stun wasn't applied this turn
    if (currentPlayerObj.stunned && !currentPlayerObj.stunnedThisTurn) {
        currentPlayerObj.stunned = false;
        logMessage(`Player ${gameState.currentPlayer} is no longer stunned`, 'action');
    }
    
    // Reset stunnedThisTurn flag for next turn
    if (currentPlayerObj.stunnedThisTurn) {
        currentPlayerObj.stunnedThisTurn = false;
    }
    
    // Gain 1 AP at end of turn (capped at 6)
    currentPlayerObj.ap = Math.min(6, currentPlayerObj.ap + 1);
    
    // Switch players
    gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
    gameState.currentAction = null;
    gameState.selectedCell = null;
    gameState.pendingShove = null;
    
    // Reset action flags for new turn
    gameState.hasActedThisTurn = false;
    gameState.hasRestedThisTurn = false;
    
    logMessage(`Turn ended. Player ${gameState.currentPlayer}'s turn begins.`, 'action');
    
    updateUI();
}

// End game
function endGame(winnerId) {
    gameState.gameOver = true;
    logMessage(`Player ${winnerId} wins!`, 'action');
    
    document.getElementById('winner-text').textContent = `Player ${winnerId} Wins!`;
    document.getElementById('game-over-modal').classList.remove('hidden');
}

// Restart game
function restartGame() {
    // Reset game state
    gameState.board = Array(3).fill(null).map(() => Array(3).fill(null));
    gameState.players = {
        1: { hp: 7, maxHp: 7, ap: 0, position: { row: 0, col: 1 }, stunned: false, stunnedThisTurn: false },
        2: { hp: 7, maxHp: 7, ap: 0, position: { row: 2, col: 1 }, stunned: false, stunnedThisTurn: false }
    };
    gameState.currentPlayer = 1;
    gameState.currentAction = null;
    gameState.selectedCell = null;
    gameState.lungingStrikesState = null;
    gameState.pendingShove = null;
    gameState.hasActedThisTurn = false;
    gameState.hasRestedThisTurn = false;
    gameState.gameOver = false;
    
    // Clear log
    document.getElementById('log-content').innerHTML = '';
    
    // Hide modal
    document.getElementById('game-over-modal').classList.add('hidden');
    
    // Reinitialize
    placeInitialFighters();
    updateUI();
    logMessage('Game restarted! Player 1 begins.', 'action');
}

// Show message
function showMessage(text, type = 'info') {
    const messageDiv = document.getElementById('action-message');
    messageDiv.textContent = text;
    messageDiv.className = `action-message ${type}`;
}

// Log message to game log
function logMessage(text, type = 'action') {
    const logContent = document.getElementById('log-content');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = text;
    logContent.appendChild(entry);
    logContent.scrollTop = logContent.scrollHeight;
}

// Initialize game when page loads
window.addEventListener('DOMContentLoaded', initGame);
