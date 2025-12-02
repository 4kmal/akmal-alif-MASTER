// ASCII Animation Controller
class ASCIIAnimationController {
    constructor() {
        this.container = document.getElementById('asciiAnimation');
        this.isPlaying = true;
        this.speed = 1;
        this.frameCount = 0;
        this.lastTime = 0;
        this.fps = 60;
        this.targetFPS = 60;
        
        // ASCII characters for animation
        this.characters = ['█', '▓', '▒', '░', '▄', '▀', '■', '□', '▪', '▫', '●', '○', '◆', '◇', '★', '☆'];
        this.matrixChars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F', 'ア', 'イ', 'ウ', 'エ', 'オ'];
        
        // Animation state
        this.columns = [];
        this.rows = 0;
        this.cols = 0;
        this.animationId = null;
        
        this.init();
        this.bindEvents();
        this.startAnimation();
    }
    
    init() {
        this.calculateDimensions();
        this.initializeColumns();
        this.updateStats();
    }
    
    calculateDimensions() {
        const rect = this.container.getBoundingClientRect();
        const charWidth = 8; // Approximate character width in pixels
        const charHeight = 14; // Approximate character height in pixels
        
        this.cols = Math.floor(rect.width / charWidth);
        this.rows = Math.floor(rect.height / charHeight);
    }
    
    initializeColumns() {
        this.columns = [];
        for (let i = 0; i < this.cols; i++) {
            this.columns.push({
                y: Math.random() * this.rows,
                speed: Math.random() * 0.5 + 0.1,
                chars: this.generateColumnChars(),
                opacity: Math.random() * 0.8 + 0.2
            });
        }
    }
    
    generateColumnChars() {
        const chars = [];
        const length = Math.floor(Math.random() * 20) + 10;
        for (let i = 0; i < length; i++) {
            chars.push(this.matrixChars[Math.floor(Math.random() * this.matrixChars.length)]);
        }
        return chars;
    }
    
    render(currentTime) {
        if (currentTime - this.lastTime >= 1000 / this.targetFPS) {
            this.fps = Math.round(1000 / (currentTime - this.lastTime));
            this.lastTime = currentTime;
            
            let output = '';
            
            // Create a 2D array to represent the screen
            const screen = Array(this.rows).fill().map(() => Array(this.cols).fill(' '));
            
            // Update and render each column
            this.columns.forEach((column, colIndex) => {
                // Update column position
                column.y += column.speed * this.speed;
                
                // Reset column if it goes off screen
                if (column.y > this.rows + column.chars.length) {
                    column.y = -column.chars.length;
                    column.chars = this.generateColumnChars();
                    column.opacity = Math.random() * 0.8 + 0.2;
                    column.speed = Math.random() * 0.5 + 0.1;
                }
                
                // Place characters on screen
                column.chars.forEach((char, charIndex) => {
                    const y = Math.floor(column.y - charIndex);
                    if (y >= 0 && y < this.rows && colIndex < this.cols) {
                        // Create fading effect
                        const fade = charIndex === 0 ? 1 : Math.max(0, 1 - (charIndex * 0.1));
                        const opacity = Math.floor(fade * column.opacity * 255);
                        const color = `rgba(0, 255, 65, ${fade * column.opacity})`;
                        
                        if (charIndex === 0) {
                            // Bright head character
                            screen[y][colIndex] = `<span style="color: rgba(255, 255, 255, 0.9); text-shadow: 0 0 8px #00ff41;">${char}</span>`;
                        } else {
                            // Fading tail characters
                            screen[y][colIndex] = `<span style="color: ${color};">${char}</span>`;
                        }
                    }
                });
            });
            
            // Convert screen array to string
            for (let row = 0; row < this.rows; row++) {
                output += screen[row].join('') + '\n';
            }
            
            this.container.innerHTML = output;
            this.frameCount++;
            this.updateStats();
        }
        
        if (this.isPlaying) {
            this.animationId = requestAnimationFrame((time) => this.render(time));
        }
    }
    
    startAnimation() {
        if (!this.isPlaying) return;
        this.animationId = requestAnimationFrame((time) => this.render(time));
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
        this.initializeColumns();
        this.startAnimation();
    }
    
    updateStats() {
        const fpsElement = document.getElementById('fpsCounter');
        const charElement = document.getElementById('charCounter');
        const patternElement = document.getElementById('patternCounter');
        
        if (fpsElement) fpsElement.textContent = this.fps;
        if (charElement) charElement.textContent = this.cols * this.rows;
        if (patternElement) patternElement.textContent = this.columns.length;
    }
    
    handleResize() {
        this.calculateDimensions();
        this.initializeColumns();
    }
    
    bindEvents() {
        // Control buttons
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

// Initialize ASCII animation when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const asciiController = new ASCIIAnimationController();
    
    // Store reference globally for debugging
    window.asciiController = asciiController;
    
    console.log('ASCII Playground initialized! Keyboard controls: Space (play/pause), S (speed), R (reset)');
});