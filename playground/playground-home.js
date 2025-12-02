// Playground Home Page Controller
class PlaygroundHomeController {
    constructor() {
        this.toolCards = document.querySelectorAll('.tool-card');
        this.init();
        this.bindEvents();
    }
    
    init() {
        // Add entrance animations
        this.animateCardsEntrance();
        
        // Initialize card previews
        this.initCardPreviews();
    }
    
    animateCardsEntrance() {
        this.toolCards.forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(50px)';
            
            setTimeout(() => {
                card.style.transition = 'all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, 200 + (index * 150));
        });
    }
    
    initCardPreviews() {
        // ASCII Wallpaper 1 preview animation
        const matrixRain = document.querySelector('.matrix-rain');
        if (matrixRain) {
            setInterval(() => {
                const spans = matrixRain.querySelectorAll('span');
                spans.forEach(span => {
                    const chars = ['█', '▓', '▒', '░', '▄', '▀', '■', '□', '1', '0', 'A', 'B', 'C', 'D'];
                    span.textContent = chars[Math.floor(Math.random() * chars.length)];
                });
            }, 1000);
        }
        
        // CRT effect enhancement
        const crtText = document.querySelector('.crt-text');
        if (crtText) {
            const crtTexts = ['CRT', 'SWIRL', 'RETRO', 'TERM'];
            let currentIndex = 0;
            
            setInterval(() => {
                crtText.style.opacity = '0';
                setTimeout(() => {
                    crtText.textContent = crtTexts[currentIndex];
                    crtText.style.opacity = '1';
                    currentIndex = (currentIndex + 1) % crtTexts.length;
                }, 250);
            }, 2000);
        }
    }
    
    
    bindEvents() {
        // Add hover effects to tool cards
        this.toolCards.forEach(card => {
            const button = card.querySelector('.tool-card-button');
            
            card.addEventListener('mouseenter', () => {
                this.enhanceCardPreview(card);
            });
            
            card.addEventListener('mouseleave', () => {
                this.resetCardPreview(card);
            });
            
            // Add click tracking
            if (button) {
                button.addEventListener('click', (e) => {
                    const toolName = card.getAttribute('data-tool');
                    this.trackToolLaunch(toolName);
                    
                    // Visual feedback
                    button.style.transform = 'scale(0.95)';
                    setTimeout(() => {
                        button.style.transform = '';
                    }, 150);
                });
            }
        });
        
        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                this.handleKeyboardNavigation(e);
            }
        });
        
        // Add scroll effects
        window.addEventListener('scroll', () => {
            this.handleScrollEffects();
        });
    }
    
    enhanceCardPreview(card) {
        const toolType = card.getAttribute('data-tool');
        
        switch (toolType) {
            case 'ascii-wallpaper-1':
                const matrixSpans = card.querySelectorAll('.matrix-rain span');
                matrixSpans.forEach(span => {
                    span.style.animationDuration = '0.5s';
                    span.style.textShadow = '0 0 15px #00ff41';
                });
                break;
                
            case 'ascii-wallpaper-2':
                const swirlEffect = card.querySelector('.swirl-effect');
                if (swirlEffect) {
                    swirlEffect.style.animationDuration = '2s';
                }
                break;
                
            case 'tool-3':
                const rocket = card.querySelector('.rocket-icon');
                if (rocket) {
                    rocket.style.transform = 'scale(1.2) rotate(15deg)';
                }
                break;
        }
    }
    
    resetCardPreview(card) {
        const toolType = card.getAttribute('data-tool');
        
        switch (toolType) {
            case 'ascii-wallpaper-1':
                const matrixSpans = card.querySelectorAll('.matrix-rain span');
                matrixSpans.forEach(span => {
                    span.style.animationDuration = '1s';
                    span.style.textShadow = '0 0 10px #00ff41';
                });
                break;
                
            case 'ascii-wallpaper-2':
                const swirlEffect = card.querySelector('.swirl-effect');
                if (swirlEffect) {
                    swirlEffect.style.animationDuration = '4s';
                }
                break;
                
            case 'tool-3':
                const rocket = card.querySelector('.rocket-icon');
                if (rocket) {
                    rocket.style.transform = '';
                }
                break;
        }
    }
    
    handleKeyboardNavigation(e) {
        // Simple keyboard navigation between tool cards
        e.preventDefault();
        
        const buttons = Array.from(document.querySelectorAll('.tool-card-button'));
        const activeElement = document.activeElement;
        const currentIndex = buttons.indexOf(activeElement);
        
        let nextIndex;
        if (e.key === 'ArrowLeft') {
            nextIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
        } else {
            nextIndex = currentIndex < buttons.length - 1 ? currentIndex + 1 : 0;
        }
        
        buttons[nextIndex].focus();
    }
    
    handleScrollEffects() {
        const scrollY = window.scrollY;
        const header = document.querySelector('.playground-home-header');
        
        if (header) {
            // Parallax effect for header
            header.style.transform = `translateY(${scrollY * 0.3}px)`;
            header.style.opacity = Math.max(0, 1 - scrollY / 300);
        }
    }
    
    trackToolLaunch(toolName) {
        // Simple analytics tracking
        console.log(`Tool launched: ${toolName}`);
        
        // Store in localStorage for simple usage tracking
        const launches = JSON.parse(localStorage.getItem('playground_launches') || '{}');
        launches[toolName] = (launches[toolName] || 0) + 1;
        localStorage.setItem('playground_launches', JSON.stringify(launches));
    }
}

// Initialize Playground Home when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const playgroundHome = new PlaygroundHomeController();
    
    // Store reference globally for debugging
    window.playgroundHome = playgroundHome;
    
    console.log('Playground Home initialized! Use arrow keys for navigation.');
});