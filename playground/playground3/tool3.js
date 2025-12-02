// Tool 3 Coming Soon Page Controller
class Tool3Controller {
    constructor() {
        this.notifyBtn = document.querySelector('.notify-btn');
        this.bindEvents();
        this.init();
    }
    
    init() {
        // Add entrance animation
        document.addEventListener('DOMContentLoaded', () => {
            const card = document.querySelector('.tool3-card');
            if (card) {
                card.style.opacity = '0';
                card.style.transform = 'translateY(50px)';
                
                setTimeout(() => {
                    card.style.transition = 'all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, 100);
            }
        });
        
        // Initialize particle effect
        this.initParticles();
    }
    
    bindEvents() {
        if (this.notifyBtn) {
            this.notifyBtn.addEventListener('click', () => this.handleNotifyClick());
        }
        
        // Add keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Backspace') {
                window.location.href = '../index.html';
            }
        });
        
        // Add mouse move effects
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    }
    
    handleNotifyClick() {
        const originalText = this.notifyBtn.textContent;
        
        // Simple notification simulation
        this.notifyBtn.textContent = '✓ Notified!';
        this.notifyBtn.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
        this.notifyBtn.disabled = true;
        
        // Reset after 3 seconds
        setTimeout(() => {
            this.notifyBtn.textContent = originalText;
            this.notifyBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            this.notifyBtn.disabled = false;
        }, 3000);
        
        // Store notification preference
        localStorage.setItem('tool3_notify', 'true');
        
        console.log('User requested notification for Tool 3 launch');
    }
    
    handleMouseMove(e) {
        const card = document.querySelector('.tool3-card');
        if (!card) return;
        
        const rect = card.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        
        const deltaX = (e.clientX - centerX) / rect.width;
        const deltaY = (e.clientY - centerY) / rect.height;
        
        // Subtle tilt effect
        const tiltX = deltaY * 5;
        const tiltY = deltaX * -5;
        
        card.style.transform = `perspective(1000px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
        
        // Reset on mouse leave
        document.addEventListener('mouseleave', () => {
            card.style.transform = '';
        });
    }
    
    initParticles() {
        // Create additional floating elements for visual interest
        const container = document.querySelector('.floating-shapes');
        if (!container) return;
        
        // Add some sparkle effects
        for (let i = 0; i < 10; i++) {
            const sparkle = document.createElement('div');
            sparkle.className = 'sparkle';
            sparkle.style.cssText = `
                position: absolute;
                width: 4px;
                height: 4px;
                background: rgba(255, 255, 255, 0.8);
                border-radius: 50%;
                left: ${Math.random() * 100}%;
                top: ${Math.random() * 100}%;
                animation: sparkleFloat ${3 + Math.random() * 4}s infinite ease-in-out;
                animation-delay: ${Math.random() * 2}s;
            `;
            container.appendChild(sparkle);
        }
        
        // Add sparkle animation to document head
        const style = document.createElement('style');
        style.textContent = `
            @keyframes sparkleFloat {
                0%, 100% {
                    opacity: 0;
                    transform: translateY(0) scale(0.5);
                }
                50% {
                    opacity: 1;
                    transform: translateY(-20px) scale(1);
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// Initialize Tool 3 controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const tool3Controller = new Tool3Controller();
    
    // Store reference globally for debugging
    window.tool3Controller = tool3Controller;
    
    console.log('Tool 3 Coming Soon page initialized!');
});