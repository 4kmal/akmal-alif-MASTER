// Animated Grid Background Script
(function() {
    'use strict';
    
    // Create background elements
    function createBackgroundElements() {
        // Check if background already exists
        if (document.getElementById('animated-bg-container')) {
            return;
        }
        
        // Create main container
        const bgContainer = document.createElement('div');
        bgContainer.id = 'animated-bg-container';
        bgContainer.className = 'animated-bg-container';
        
        // Create black background layer
        const blackBg = document.createElement('div');
        blackBg.className = 'animated-bg-black';
        
        // Create grid layer
        const gridLayer = document.createElement('div');
        gridLayer.className = 'animated-bg-grid';
        gridLayer.id = 'animated-grid';
        
        // Create gradient overlay
        const gradientOverlay = document.createElement('div');
        gradientOverlay.className = 'animated-bg-gradient';
        
        // Append layers
        bgContainer.appendChild(blackBg);
        bgContainer.appendChild(gridLayer);
        bgContainer.appendChild(gradientOverlay);
        
        // Insert at the beginning of body
        document.body.insertBefore(bgContainer, document.body.firstChild);
        
        // Ensure body classes are preserved
        if (!document.body.classList.contains('animated-bg-active')) {
            document.body.classList.add('animated-bg-active');
        }
    }
    
    // Mouse movement handler
    function handleMouseMovement() {
        const grid = document.getElementById('animated-grid');
        if (!grid) return;
        
        let mouseX = 0;
        let mouseY = 0;
        let currentX = 0;
        let currentY = 0;
        let animationFrame = null;
        
        // Smooth animation using requestAnimationFrame
        function updateGridPosition() {
            // Spring-like interpolation
            const springStiffness = 0.05;
            const damping = 0.8;
            
            currentX += (mouseX - currentX) * springStiffness;
            currentY += (mouseY - currentY) * springStiffness;
            
            // Apply damping
            currentX *= damping;
            currentY *= damping;
            
            // Apply transform
            grid.style.transform = `translate(${currentX}px, ${currentY}px)`;
            
            animationFrame = requestAnimationFrame(updateGridPosition);
        }
        
        // Mouse move event listener
        document.addEventListener('mousemove', (e) => {
            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;
            
            // Calculate offset from center (limited to ±20px like in the React example)
            mouseX = ((e.clientX - centerX) / centerX) * 20;
            mouseY = ((e.clientY - centerY) / centerY) * 20;
        });
        
        // Start animation
        updateGridPosition();
        
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
            }
        });
    }
    
    // Initialize on DOM load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            createBackgroundElements();
            handleMouseMovement();
        });
    } else {
        createBackgroundElements();
        handleMouseMovement();
    }
})();