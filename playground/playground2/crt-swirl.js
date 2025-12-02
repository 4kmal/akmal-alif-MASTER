// CRT Swirl Animation Controller
class CRTSwirlController {
    constructor() {
        this.container = document.getElementById('textGrid');
        this.titleElement = document.getElementById('crtTitle');
        this.isPlaying = true;
        this.speed = 1;
        this.animationId = null;
        this.startTime = undefined;
        this.frameCount = 0;
        
        // Text content for swirl animation
        this.textContent = `
/playground ASCII art and animation playground for creative coding experiments and visual effects.
/playground Interactive terminal-style animations with retro CRT monitor aesthetics and effects.
/playground Customizable text swirl patterns with dynamic character positioning and movement.
/playground Real-time ASCII character manipulation with smooth transitions and visual flair.
/playground Retro computing vibes with authentic CRT scanlines and phosphor glow effects.
/playground Experience the nostalgia of old-school terminal graphics and text-based interfaces.
/playground Dynamic text animation system with configurable speed and pattern variations.
/playground Classic computer graphics techniques reimagined for modern web experiences.
`;
        
        this.sentences = this.textContent.split(/[\n\r]/)
            .filter(s => s.length > 0)
            .map(s => s + " ");
        
        // Grid state
        this.precalculatedCellMap = [];
        this.grid = { rows: 0, cols: 0 };
        this.lastPositions = new Map();
        this.titleBox = null;
        
        this.init();
        this.bindEvents();
        this.startAnimation();
    }
    
    init() {
        this.initGrid();
        this.revealTitle();
    }
    
    getCharAt(x, y) {
        const si = y % this.sentences.length;
        const ci = Math.min(x, this.sentences[si].length - 1);
        return this.sentences[si][ci] || " ";
    }
    
    initGrid() {
        if (!this.container) return;
        
        const cellWidth = 12;
        const cellHeight = 18;
        
        // Calculate grid dimensions
        const newCols = Math.ceil(window.innerWidth / cellWidth);
        const newRows = Math.ceil(window.innerHeight / cellHeight);
        this.grid = { rows: newRows, cols: newCols };
        
        // Clear previous state
        this.lastPositions = new Map();
        this.precalculatedCellMap = [];
        this.container.innerHTML = "";
        
        const centerX = 0.5;
        const centerY = 0.5;
        const fragment = document.createDocumentFragment();
        
        for (let y = 0; y < newRows; y++) {
            const row = document.createElement("div");
            row.className = "flex";
            this.precalculatedCellMap[y] = [];
            
            for (let x = 0; x < newCols; x++) {
                const cellElement = document.createElement("div");
                cellElement.className = "cell";
                
                const char = this.getCharAt(x, y);
                cellElement.textContent = char;
                row.appendChild(cellElement);
                
                const dx = x / newCols - centerX;
                const dy = y / newRows - centerY;
                
                this.precalculatedCellMap[y][x] = {
                    element: cellElement,
                    char: char,
                    dist: Math.sqrt(dx * dx + dy * dy),
                    initialAngle: Math.atan2(dy, dx)
                };
            }
            fragment.appendChild(row);
        }
        
        this.container.appendChild(fragment);
    }
    
    revealTitle() {
        const title = "CRT SWIRL";
        let revealedTitle = "";
        
        const revealTimer = setTimeout(() => {
            const interval = setInterval(() => {
                if (revealedTitle.length < title.length) {
                    revealedTitle = title.substring(0, revealedTitle.length + 1);
                    this.titleElement.textContent = revealedTitle;
                } else {
                    clearInterval(interval);
                }
            }, 120);
        }, 500);
    }
    
    drawText(currentTime) {
        const { rows, cols } = this.grid;
        if (!rows || !cols) return;
        
        // Skip frames for performance
        this.frameCount++;
        if (this.frameCount % 2 !== 0) return;
        
        const centerX = 0.5;
        const centerY = 0.5;
        const timeFactor = currentTime * 0.08 * this.speed;
        
        const newPositions = new Map();
        const batchUpdates = [];
        
        // Calculate new positions with swirl effect
        for (let y = 0; y < rows; y += 2) {
            for (let x = 0; x < cols; x += 2) {
                const cell = this.precalculatedCellMap[y]?.[x];
                if (!cell) continue;
                
                const newAngle = cell.initialAngle - Math.pow(cell.dist, 0.4) * timeFactor;
                const nx = centerX + Math.cos(newAngle) * cell.dist;
                const ny = centerY + Math.sin(newAngle) * cell.dist;
                const newX = Math.floor(nx * cols);
                const newY = Math.floor(ny * rows);
                
                if (newX >= 0 && newY >= 0 && newY < rows && newX < cols) {
                    const key = `${newY}-${newX}`;
                    if (!newPositions.has(key)) {
                        newPositions.set(key, cell.char);
                    }
                }
            }
        }
        
        // Batch clear operations
        for (const [key] of this.lastPositions) {
            if (!newPositions.has(key)) {
                const [y, x] = key.split("-").map(Number);
                const cell = this.precalculatedCellMap[y]?.[x];
                if (cell?.element) {
                    batchUpdates.push({ element: cell.element, char: " " });
                }
            }
        }
        
        // Batch update operations
        for (const [key, char] of newPositions) {
            if (char !== this.lastPositions.get(key)) {
                const [y, x] = key.split("-").map(Number);
                const cell = this.precalculatedCellMap[y]?.[x];
                if (cell?.element) {
                    batchUpdates.push({ element: cell.element, char });
                }
            }
        }
        
        // Apply all updates
        requestAnimationFrame(() => {
            for (const update of batchUpdates) {
                update.element.textContent = update.char;
            }
        });
        
        this.lastPositions = newPositions;
    }
    
    animate(timestamp) {
        if (this.startTime === undefined) {
            this.startTime = timestamp;
        }
        
        const currentTime = (timestamp - this.startTime) / 1000;
        this.drawText(currentTime);
        
        if (this.isPlaying) {
            this.animationId = requestAnimationFrame((time) => this.animate(time));
        }
    }
    
    startAnimation() {
        if (!this.isPlaying) return;
        this.animationId = requestAnimationFrame((time) => this.animate(time));
    }
    
    stopAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    
    togglePlayPause() {
        this.isPlaying = !this.isPlaying;
        if (this.isPlaying) {
            this.startAnimation();
        } else {
            this.stopAnimation();
        }
        return this.isPlaying;
    }
    
    changeSpeed() {
        this.speed = this.speed >= 3 ? 1 : this.speed + 1;
        return this.speed;
    }
    
    reset() {
        this.stopAnimation();
        this.frameCount = 0;
        this.speed = 1;
        this.isPlaying = true;
        this.startTime = undefined;
        this.initGrid();
        this.revealTitle();
        this.startAnimation();
    }
    
    handleResize() {
        this.initGrid();
    }
    
    bindEvents() {
        const playPauseBtn = document.getElementById('playPauseBtn');
        const speedBtn = document.getElementById('speedBtn');
        const resetBtn = document.getElementById('resetBtn');
        
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => {
                const isPlaying = this.togglePlayPause();
                playPauseBtn.textContent = isPlaying ? '⏸️ Pause' : '▶️ Play';
            });
        }
        
        if (speedBtn) {
            speedBtn.addEventListener('click', () => {
                const speed = this.changeSpeed();
                speedBtn.textContent = `🚀 ${speed}x Speed`;
            });
        }
        
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.reset();
                if (playPauseBtn) playPauseBtn.textContent = '⏸️ Pause';
                if (speedBtn) speedBtn.textContent = '🚀 Speed';
            });
        }
        
        // Handle window resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.handleResize();
            }, 250);
        });
        
        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            switch(e.code) {
                case 'Space':
                    e.preventDefault();
                    playPauseBtn?.click();
                    break;
                case 'KeyS':
                    e.preventDefault();
                    speedBtn?.click();
                    break;
                case 'KeyR':
                    e.preventDefault();
                    resetBtn?.click();
                    break;
            }
        });
    }
}

// Initialize CRT Swirl animation when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const crtController = new CRTSwirlController();
    
    // Store reference globally for debugging
    window.crtController = crtController;
    
    console.log('CRT Swirl initialized! Keyboard controls: Space (play/pause), S (speed), R (reset)');
});