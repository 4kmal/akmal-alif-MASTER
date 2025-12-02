// ========== OPTIMIZED CANVAS-BASED TEXT VORTEX BACKGROUND ==========
// High-performance swirling text effect using HTML5 Canvas

class TextVortexBackground {
    constructor() {
        this.str = `
                /dream 4kmal4lif creative developer designer 10x engineer quantum computing enthusiast
                /dream blockchain developer web3 pioneer AI/ML specialist full-stack architect
                /dream react angular vue.js node.js python django flask laravel php mysql postgresql
                /dream docker kubernetes aws azure gcp devops ci/cd jenkins terraform ansible
                /dream javascript typescript golang rust solidity smart contracts defi nft metaverse
                /dream threejs webgl canvas svg animation gsap framer motion lottie cyberpunk
                /dream Lorem ipsum dolor sit amet consectetur adipiscing elit sed tempor incididunt
                /dream Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi
                /dream Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
                /dream Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia
                /dream At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis
                /dream Et harum quidem rerum facilis est et expedita distinctio nam libero tempore
        `;

        this.sentences = this.str.split(/[\n\r]/).filter(s => s.length > 0).map(s => s.trim() + ' ');
        
        this.root = document.querySelector('#text-grid');
        if (!this.root) {
            console.error('❌ Text grid container not found');
            return;
        }
        
        // Performance tracking
        this.frameCount = 0;
        this.fpsCounter = 0;
        this.lastFpsUpdate = 0;
        
        this.init();
    }
    
    init() {
        console.log('🌀 Initializing Optimized Text Vortex Background...');
        
        // Create canvas element
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Setup canvas
        this.setupCanvas();
        
        // Replace div with canvas
        this.root.innerHTML = '';
        this.root.appendChild(this.canvas);
        
        // Configure rendering settings
        this.setupRenderer();
        
        // Start animation
        this.animationBegin = null;
        this.lastFrameTime = 0;
        this.targetFPS = 60;
        this.frameInterval = 1000 / this.targetFPS;
        
        this.startAnimation();
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
        
        console.log(`✅ Canvas-based Text Vortex initialized - Target: ${this.targetFPS}fps`);
    }
    
    setupCanvas() {
        // Get device pixel ratio for sharp rendering
        this.pixelRatio = window.devicePixelRatio || 1;
        
        // Set canvas size
        this.updateCanvasSize();
        
        // Configure optimized grid parameters
        this.updateGridParameters();
    }
    
    updateCanvasSize() {
        const rect = this.root.getBoundingClientRect();
        const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
        const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
        
        // Set logical size
        this.width = vw;
        this.height = vh;
        
        // Set actual canvas size with pixel ratio
        this.canvas.width = this.width * this.pixelRatio;
        this.canvas.height = this.height * this.pixelRatio;
        
        // Set display size
        this.canvas.style.width = this.width + 'px';
        this.canvas.style.height = this.height + 'px';
        
        // Scale context for crisp rendering
        this.ctx.scale(this.pixelRatio, this.pixelRatio);
    }
    
    updateGridParameters() {
        // Optimized grid sizes for performance
        if (this.width < 768) { // Mobile
            this.rows = 15; // Reduced from 25
            this.cols = 30; // Reduced significantly  
            this.fontSize = 10;
            this.cellWidth = 12;
            this.cellHeight = 16;
        } else if (this.width < 1024) { // Tablet
            this.rows = 18; // Reduced from 30
            this.cols = 40; // Reduced significantly
            this.fontSize = 11;
            this.cellWidth = 14;
            this.cellHeight = 18;
        } else { // Desktop
            this.rows = 20; // Reduced from 35
            this.cols = 50; // Reduced from 100+
            this.fontSize = 12;
            this.cellWidth = 16;
            this.cellHeight = 20;
        }
        
        console.log(`📊 Grid: ${this.cols}×${this.rows} = ${this.cols * this.rows} cells`);
    }
    
    setupRenderer() {
        // Configure canvas context for performance
        this.ctx.font = `${this.fontSize}px press-start, monospace`;
        this.ctx.fillStyle = 'rgb(96,124,198)'; // Light blue text
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'top';
        
        // Disable antialiasing for pixel-perfect rendering (performance boost)
        this.ctx.imageSmoothingEnabled = false;
    }
    
    getCharAt(x, y) {
        const si = y % this.sentences.length;
        const ci = Math.min(x, this.sentences[si].length - 1);
        return this.sentences[si][ci] || ' ';
    }
    
    transform(x, y, centerX, centerY, time) {
        const dx = x - centerX;
        const dy = y - centerY;
        
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        const currAngle = Math.atan2(dy, dx);
        const newAngle = currAngle - Math.pow(dist, 0.4) * time * 0.05; // Optimized calculation
        
        return [
            centerX + Math.cos(newAngle) * dist,
            centerY + Math.sin(newAngle) * dist
        ];
    }
    
    startAnimation() {
        this.animate();
    }
    
    animate(currentTime) {
        // FPS throttling for consistent performance
        if (currentTime - this.lastFrameTime < this.frameInterval) {
            requestAnimationFrame((time) => this.animate(time));
            return;
        }
        
        if (this.animationBegin === null) {
            this.animationBegin = currentTime;
        }
        
        const deltaTime = currentTime - this.lastFrameTime;
        this.lastFrameTime = currentTime;
        
        // Calculate animation time
        const time = (currentTime - this.animationBegin) / 1000;
        
        // Clear canvas efficiently
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        // Draw text vortex
        this.drawText(time);
        
        // FPS monitoring (only in development)
        this.updateFPS(currentTime);
        
        // Continue animation
        requestAnimationFrame((time) => this.animate(time));
    }
    
    drawText(time) {
        // Pre-calculate center
        const centerX = 0.5;
        const centerY = 0.5;
        
        // Batch character rendering for performance
        this.ctx.save();
        
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) {
                // Transform coordinates
                const [nx, ny] = this.transform(
                    x / this.cols, 
                    y / this.rows, 
                    centerX, 
                    centerY, 
                    time
                );
                
                // Convert to pixel coordinates
                const pixelX = Math.floor(nx * this.cols) * this.cellWidth;
                const pixelY = Math.floor(ny * this.rows) * this.cellHeight;
                
                // Bounds check
                if (pixelX < 0 || pixelY < 0 || pixelX >= this.width || pixelY >= this.height) {
                    continue;
                }
                
                // Get character and render
                const char = this.getCharAt(x, y);
                if (char !== ' ') {
                    // Add subtle color variation based on position
                    const colorVariation = Math.sin(time + x * 0.1 + y * 0.1) * 20;
                    const blue = Math.max(100, Math.min(255, 198 + colorVariation));
                    this.ctx.fillStyle = `rgb(96,124,${Math.floor(blue)})`;
                    
                    this.ctx.fillText(char, pixelX, pixelY);
                }
            }
        }
        
        this.ctx.restore();
    }
    
    updateFPS(currentTime) {
        this.frameCount++;
        
        if (currentTime - this.lastFpsUpdate > 1000) {
            this.fpsCounter = Math.round(this.frameCount * 1000 / (currentTime - this.lastFpsUpdate));
            this.frameCount = 0;
            this.lastFpsUpdate = currentTime;
            
            // Log performance issues
            if (this.fpsCounter < 50) {
                console.warn(`⚠️ Performance warning: ${this.fpsCounter}fps`);
            }
        }
    }
    
    handleResize() {
        // Debounce resize events
        clearTimeout(this.resizeTimeout);
        this.resizeTimeout = setTimeout(() => {
            this.updateCanvasSize();
            this.updateGridParameters();
            this.setupRenderer();
        }, 100);
    }
    
    // Public API methods
    pause() {
        this.isPaused = true;
    }
    
    resume() {
        this.isPaused = false;
    }
    
    getCurrentFPS() {
        return this.fpsCounter;
    }
    
    getPerformanceStats() {
        return {
            fps: this.fpsCounter,
            gridSize: this.cols * this.rows,
            resolution: `${this.width}×${this.height}`,
            pixelRatio: this.pixelRatio
        };
    }
    
    destroy() {
        this.isPaused = true;
        if (this.root && this.canvas) {
            this.root.removeChild(this.canvas);
        }
        window.removeEventListener('resize', this.handleResize);
        console.log('🌀 Text Vortex destroyed');
    }
}

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', () => {
    // Initialize text vortex background after a small delay
    setTimeout(() => {
        const textVortex = new TextVortexBackground();
        window.textVortex = textVortex; // Make available globally for debugging
        console.log('🌀 Text Vortex Background fully loaded and running!');
        
        // Performance monitor for debugging
        window.vortexStats = () => {
            const stats = textVortex.getPerformanceStats();
            console.log('📊 Text Vortex Performance Stats:', stats);
            return stats;
        };
        
        // Performance optimization functions
        window.vortexPause = () => textVortex.pause();
        window.vortexResume = () => textVortex.resume();
        
    }, 100);
});

// Fallback initialization
if (document.readyState === 'complete') {
    setTimeout(() => {
        if (!window.textVortex) {
            const textVortex = new TextVortexBackground();
            window.textVortex = textVortex;
        }
    }, 50);
}