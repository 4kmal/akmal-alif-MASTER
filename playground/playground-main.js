
// ========== 3D CREATIVE PLAYGROUND CONTROLLER ==========
// AWGE-inspired 3D video carousel adapted for creative tools

class Creative3DPlaygroundController {
    constructor() {
        this.currentTool = 1;
        this.isInitialized = false;
        
        // AWGE video/gif data for the 3D carousel
        this.tools = {
            1: {
                id: 'awge-01',
                link: "https://dwvo2npct47gg.cloudfront.net/videos/monsterew-cropped.mp4",
                gif: "https://dwvo2npct47gg.cloudfront.net/gifs/wrong.gif",
                title: "Thronglets",
                desc: "Small bugs inside Cyberspace",
                url: "https://dwvo2npct47gg.cloudfront.net/videos/monsterew-cropped.mp4"
            },
            2: {
                id: 'awge-02',
                link: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-1-compressed.mp4",
                gif: "https://dwvo2npct47gg.cloudfront.net/gifs/rocky-1.gif",
                title: "Blackhole",
                desc: "three.js, webgl",
                url: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-1-compressed.mp4"
            },
            3: {
                id: 'playground-3',
                link: "./playground3/index.html",
                gif: "../assets/picture/awge/gallery_37.png",
                title: "Time Travel",
                desc: "Mobius Strip",
                url: "./playground3/index.html"
            },
            4: {
                id: 'awge-04',
                link: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-concert.mp4",
                gif: "https://dwvo2npct47gg.cloudfront.net/gifs/rocky-concert.gif",
                title: "Kanye's Stem Player",
                desc: "Stem Player that seperates different tracks",
                url: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-concert.mp4"
            },
            5: {
                id: 'awge-05',
                link: "https://embed.vevo.com?isrc=USSM21701029&autoplay=true",
                gif: "https://dwvo2npct47gg.cloudfront.net/gifs/feels.gif",
                isVevo: true,
                title: "Beatbot Player",
                desc: "Beatbot, Beatbot, Beatbot",
                url: "https://embed.vevo.com?isrc=USSM21701029&autoplay=true"
            },
            6: {
                id: 'awge-06',
                link: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-music.mp4",
                gif: "https://dwvo2npct47gg.cloudfront.net/gifs/rocky-music.gif",
                title: "Video Game 1",
                desc: "Description",
                url: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-music.mp4"
            },
            7: {
                id: 'awge-07',
                link: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-home.mp4",
                gif: "https://dwvo2npct47gg.cloudfront.net/gifs/rocky-home.gif",
                title: "Playground 7",
                desc: "Taman Permainan 7",
                url: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-home.mp4"
            },
            8: {
                id: 'awge-08',
                link: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-jail.mp4",
                gif: "../assets/picture/awge/gallery_54.png",
                title: "Playground 8",
                desc: "Taman Permainan 8",
                url: "https://dwvo2npct47gg.cloudfront.net/videos/rocky-jail.mp4"
            }
        };
        
        this.init();
    }

    init() {
        console.log('🎨 3D Creative Playground initializing...');
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeComponents());
        } else {
            this.initializeComponents();
        }
    }

    initializeComponents() {
        this.carousel = document.querySelector('.playground-carousel-carousel');
        this.infoTitle = document.getElementById('playground-info-title');
        this.infoDescription = document.getElementById('playground-info-description');
        this.launchButton = document.getElementById('playground-launch-btn');
        this.prevButton = document.getElementById('playground-info-prev');
        this.nextButton = document.getElementById('playground-info-next');
        
        // Initialize scramble effects for title and description
        this.titleScramble = null;
        this.descriptionScramble = null;

        if (!this.carousel) {
            console.error('❌ Carousel container not found!');
            return;
        }

        // Build the 3D carousel
        this.buildCarousel();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Initialize scramble effects
        this.setupScrambleEffects();
        
        // Initialize with first tool (awge-01)
        const numTools = Object.keys(this.tools).length;
        this.currentTool = 1; // Start with first tool instead of center
        this.updateInfo();
        
        this.isInitialized = true;
        console.log('✅ 3D Creative Playground initialized with', numTools, 'tools');
    }

    buildCarousel() {
        const numTools = Object.keys(this.tools).length;
        const currentTool = this.currentTool || 1; // Use current tool as reference (defaults to 1)

        // Clear existing content
        this.carousel.innerHTML = '';

        // Build all tools with first tool as current
        for (let i = 1; i <= numTools; i++) {
            this.createToolCard(i, currentTool, i === currentTool);
        }

        console.log('🔧 Built 3D carousel with', numTools, 'tools, starting with tool', currentTool);
    }

    createToolCard(toolIndex, centerIndex, isCenter = false) {
        const tool = this.tools[toolIndex];
        if (!tool) return;

        const card = document.createElement('div');
        card.id = `tool-${toolIndex}`;
        card.className = `playground-tool-card ${isCenter ? 'current-tool' : ''}`;
        
        // Calculate 3D transform for perfect 8-item circle
        const numItems = Object.keys(this.tools).length;
        const angleStep = 360 / numItems; // 360/8 = 45 degrees per item
        const rotationY = (toolIndex - centerIndex) * angleStep;
        const translateZ = 'translateZ(30vw)'; // Reduced for smaller carousel
        card.style.transform = `rotateY(${rotationY}deg) ${translateZ}`;
        
        // Add mobile-specific styles
        this.addMobileStyles(toolIndex, centerIndex);

        // Create content
        card.innerHTML = `
            <div class="tool-preview">
                <img src="${tool.gif}" class="tool-gif" alt="${tool.title}" />
                <div class="tool-overlay">
                    <h3>${tool.title}</h3>
                    <p>${tool.desc}</p>
                </div>
            </div>
        `;

        // Add click handler
        card.addEventListener('click', () => this.onToolClick(toolIndex));

        this.carousel.appendChild(card);
    }

    addMobileStyles(toolIndex, centerIndex) {
        const numItems = Object.keys(this.tools).length;
        const angleStep = 360 / numItems; // Same calculation for mobile
        const rotationY = (toolIndex - centerIndex) * angleStep;
        // Use smaller translateZ for mobile to prevent overlapping
        const mobileTranslateZ = 'translateZ(20vw)'; // Reduced from 35vw to prevent overlap
        const translateZ = mobileTranslateZ;
        
        const style = document.createElement('style');
        style.type = 'text/css';
        style.innerHTML = `
            @media screen and (max-width: 480px) {
                #tool-${toolIndex} {
                    transform: rotateY(${rotationY}deg) translateZ(12vw) !important;
                }
            }
            @media screen and (min-width: 481px) and (max-width: 768px) {
                #tool-${toolIndex} {
                    transform: rotateY(${rotationY}deg) translateZ(16vw) !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    setupEventListeners() {
        // Navigation buttons
        if (this.nextButton) {
            this.nextButton.addEventListener('click', () => this.rotateTool(1));
        }
        
        if (this.prevButton) {
            this.prevButton.addEventListener('click', () => this.rotateTool(-1));
        }

        // Launch button
        if (this.launchButton) {
            this.launchButton.addEventListener('click', () => this.launchCurrentTool());
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.rotateTool(-1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.rotateTool(1);
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.launchCurrentTool();
            }
        });

        // Touch/swipe support (simplified)
        this.setupTouchSupport();
        
        // Mouse wheel support (extra smooth)
        this.setupWheelSupport();
    }

    setupTouchSupport() {
        let touchStartX = 0;
        let touchEndX = 0;

        this.carousel.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
        });

        this.carousel.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            this.handleSwipe();
        });

        const handleSwipe = () => {
            const swipeThreshold = 50;
            const diff = touchStartX - touchEndX;
            
            if (Math.abs(diff) > swipeThreshold) {
                if (diff > 0) {
                    this.rotateTool(1); // Swipe left - next
                } else {
                    this.rotateTool(-1); // Swipe right - previous
                }
            }
        };

        this.handleSwipe = handleSwipe;
    }

    setupWheelSupport() {
        // Throttling variables for smooth scrolling
        this.wheelTimeout = null;
        this.isWheelScrolling = false;
        
        // Get carousel container for wheel events
        const carouselContainer = document.querySelector('.playground-carousel-container');
        if (!carouselContainer) return;
        
        // Wheel event listener with smooth throttling
        carouselContainer.addEventListener('wheel', (e) => {
            e.preventDefault(); // Prevent page scroll
            
            // Skip if already processing wheel scroll
            if (this.isWheelScrolling) return;
            
            // Determine scroll direction
            const deltaY = e.deltaY;
            const scrollDirection = deltaY > 0 ? 1 : -1; // Positive = next, negative = previous
            
            // Set scrolling flag
            this.isWheelScrolling = true;
            
            // Execute rotation
            this.rotateTool(scrollDirection);
            
            // Clear previous timeout
            if (this.wheelTimeout) {
                clearTimeout(this.wheelTimeout);
            }
            
            // Reset scrolling flag after smooth delay
            this.wheelTimeout = setTimeout(() => {
                this.isWheelScrolling = false;
            }, 600); // Slightly longer than rotation animation (500ms)
            
        }, { passive: false });
        
        console.log('🎡 Mouse wheel support enabled for carousel');
    }

    setupScrambleEffects() {
        // Check if createScrambleText is available
        if (typeof window.createScrambleText === 'undefined') {
            console.warn('⚠️ createScrambleText not loaded - scramble effects disabled');
            return;
        }

        // Initialize title scramble with settings matching ScrambleText.tsx
        if (this.infoTitle) {
            this.titleScramble = window.createScrambleText(this.infoTitle, {
                speed: 0.8,     // From ScrambleText.tsx:25
                tick: 1,        // From ScrambleText.tsx:25  
                step: 2.3,      // From ScrambleText.tsx:25
                scramble: 10,   // From ScrambleText.tsx:25
                chance: 0.8,    // From ScrambleText.tsx:25
                overdrive: false // From ScrambleText.tsx:25
            });
        }

        // Initialize description scramble with same settings
        if (this.infoDescription) {
            this.descriptionScramble = window.createScrambleText(this.infoDescription, {
                speed: 0.8,     // From ScrambleText.tsx:25
                tick: 1,        // From ScrambleText.tsx:25
                step: 2.3,      // From ScrambleText.tsx:25
                scramble: 10,   // From ScrambleText.tsx:25
                chance: 0.8,    // From ScrambleText.tsx:25
                overdrive: false // From ScrambleText.tsx:25
            });
        }

        // Add interaction triggers
        this.setupScrambleInteractions();

        console.log('✨ Scramble effects initialized for title and description');
    }

    setupScrambleInteractions() {
        // Trigger scrambles on title/description hover
        if (this.infoTitle) {
            this.infoTitle.addEventListener('mouseenter', () => {
                this.triggerTitleScramble();
            });
        }

        if (this.infoDescription) {
            this.infoDescription.addEventListener('mouseenter', () => {
                this.triggerDescriptionScramble();
            });
        }

        // Also trigger on focus for accessibility
        if (this.infoTitle) {
            this.infoTitle.addEventListener('focus', () => {
                this.triggerTitleScramble();
            });
        }

        if (this.infoDescription) {
            this.infoDescription.addEventListener('focus', () => {
                this.triggerDescriptionScramble();
            });
        }
    }

    triggerTitleScramble() {
        if (this.titleScramble && this.titleScramble.replay) {
            this.titleScramble.replay();
        }
    }

    triggerDescriptionScramble() {
        if (this.descriptionScramble && this.descriptionScramble.replay) {
            this.descriptionScramble.replay();
        }
    }

    triggerAllScrambles() {
        // Stagger the scrambles for better visual effect
        this.triggerTitleScramble();
        setTimeout(() => {
            this.triggerDescriptionScramble();
        }, 200); // 200ms delay between title and description
    }

    rotateTool(offset) {
        const numTools = Object.keys(this.tools).length;
        const angleStep = 360 / numTools;

        // Remove current tool highlight
        const currentElement = document.getElementById(`tool-${this.currentTool}`);
        if (currentElement) {
            currentElement.classList.remove('current-tool');
        }

        // Update current tool with infinite wrapping
        this.currentTool += offset;
        this.startTextGlitch();

        // Infinite wrapping - no boundaries!
        if (this.currentTool < 1) {
            this.currentTool = numTools; // Wrap to last item
        } else if (this.currentTool > numTools) {
            this.currentTool = 1; // Wrap to first item
        }

        // Smooth rotation - rotate around first tool as reference (tool 1)
        const deg = (1 - this.currentTool) * angleStep;
        this.carousel.style.transform = `rotateY(${deg}deg)`;
        this.carousel.style.transition = 'transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';

        // Update current tool highlight
        const newCurrentElement = document.getElementById(`tool-${this.currentTool}`);
        if (newCurrentElement) {
            newCurrentElement.classList.add('current-tool');
        }

        // Update info after animation
        setTimeout(() => {
            this.updateInfo();
            this.stopTextGlitch();
        }, 500);
    }


    updateInfo() {
        const tool = this.tools[this.currentTool];
        if (!tool) return;

        // Update title
        if (this.infoTitle) {
            this.infoTitle.textContent = tool.title;
            this.infoTitle.setAttribute('data-text', tool.title);
            
            // Update scramble text if available
            if (this.titleScramble && this.titleScramble.updateText) {
                this.titleScramble.updateText(tool.title);
            }
        }

        // Update description  
        if (this.infoDescription) {
            this.infoDescription.textContent = tool.desc;
            this.infoDescription.setAttribute('data-text', tool.desc);
            
            // Update scramble text if available
            if (this.descriptionScramble && this.descriptionScramble.updateText) {
                this.descriptionScramble.updateText(tool.desc);
            }
        }

        // Trigger scramble effects when content changes (like carousel navigation)
        setTimeout(() => {
            this.triggerAllScrambles();
        }, 100); // Small delay to ensure DOM updates first
    }

    onToolClick(toolIndex) {
        console.log('🎯 Tool clicked:', toolIndex);
        
        // If clicking current tool, launch it
        if (toolIndex === this.currentTool) {
            this.launchCurrentTool();
        } else {
            // Navigate to clicked tool
            const offset = toolIndex - this.currentTool;
            this.rotateTool(offset);
        }
    }

    launchCurrentTool() {
        const tool = this.tools[this.currentTool];
        if (!tool) return;

        console.log('🚀 Launching AWGE video:', tool.title);

        // Visual feedback
        const currentElement = document.getElementById(`tool-${this.currentTool}`);
        if (currentElement) {
            currentElement.style.transform += ' scale(0.95)';
            setTimeout(() => {
                currentElement.style.transform = currentElement.style.transform.replace(' scale(0.95)', '');
            }, 150);
        }

        // Launch tool/video
        if (tool.link && tool.url) {
            if (this.launchButton) {
                this.launchButton.textContent = 'LAUNCHING...';
                this.launchButton.style.opacity = '0.7';
            }

            setTimeout(() => {
                if (tool.id === 'playground-3') {
                    // Navigate to playground3
                    window.location.href = tool.url;
                } else if (tool.isVevo) {
                    // Open Vevo embed in new tab
                    window.open(tool.url, '_blank');
                } else {
                    // Create fullscreen video modal for regular videos
                    this.openVideoModal(tool);
                }
                
                // Reset button
                if (this.launchButton) {
                    this.launchButton.textContent = tool.id === 'playground-3' ? 'ENTER' : 'PLAY VIDEO';
                    this.launchButton.style.opacity = '1';
                }
            }, 500);
        }
    }

    openVideoModal(tool) {
        // Create fullscreen video modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: #000;
            z-index: 10000; /* Above CRT effects */
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
        `;

        const video = document.createElement('video');
        video.style.cssText = `
            width: 100%;
            height: 100%;
            object-fit: contain;
        `;
        video.src = tool.link;
        video.controls = true;
        video.autoplay = true;

        const closeText = document.createElement('div');
        closeText.style.cssText = `
            position: absolute;
            top: 20px;
            right: 20px;
            color: white;
            font-family: 'press-start', monospace;
            font-size: 1rem;
            z-index: 10001;
            cursor: pointer;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
        `;
        closeText.textContent = 'CLOSE [ESC]';

        modal.appendChild(video);
        modal.appendChild(closeText);
        document.body.appendChild(modal);

        // Close handlers
        const closeModal = () => {
            document.body.removeChild(modal);
        };

        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target === closeText) {
                closeModal();
            }
        });

        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        });
    }

    startTextGlitch() {
        // Don't use CSS glitch if scramble effects are available
        if (this.titleScramble || this.descriptionScramble) {
            this.triggerAllScrambles();
            return;
        }
        
        // Fallback to CSS glitch effect
        if (this.infoTitle) this.infoTitle.classList.add('playground-text-glitch');
        if (this.infoDescription) this.infoDescription.classList.add('playground-text-glitch');
    }

    stopTextGlitch() {
        // Remove CSS glitch classes
        if (this.infoTitle) this.infoTitle.classList.remove('playground-text-glitch');
        if (this.infoDescription) this.infoDescription.classList.remove('playground-text-glitch');
    }

    showComingSoonNotification() {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) scale(0);
            background: linear-gradient(45deg, #395CC9, #F45555);
            padding: 30px;
            border-radius: 15px;
            color: white;
            text-align: center;
            z-index: 10000;
            font-family: 'press-start', monospace;
            font-size: 0.9rem;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
            transition: transform 0.3s ease;
            max-width: 300px;
        `;
        
        notification.innerHTML = `
            <h3 style="margin: 0 0 15px 0;">🚀 COMING SOON</h3>
            <p style="margin: 0; font-size: 0.7rem; line-height: 1.4;">
                This creative tool is under development.<br>
                Stay tuned for updates!
            </p>
        `;

        document.body.appendChild(notification);

        // Animate in
        setTimeout(() => {
            notification.style.transform = 'translate(-50%, -50%) scale(1)';
        }, 10);

        // Auto remove
        setTimeout(() => {
            notification.style.transform = 'translate(-50%, -50%) scale(0)';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', () => {
    // Wait for other scripts to load
    setTimeout(() => {
        const playground = new Creative3DPlaygroundController();
        window.playground3D = playground;
        console.log('🎨 3D Creative Playground fully loaded and ready!');
    }, 500);
});

// Fallback initialization
if (document.readyState === 'complete') {
    setTimeout(() => {
        if (!window.playground3D) {
            const playground = new Creative3DPlaygroundController();
            window.playground3D = playground;
        }
    }, 100);
}

// Export for debugging
window.playground3DUtils = {
    rotateTo: (toolIndex) => {
        if (window.playground3D && window.playground3D.isInitialized) {
            const offset = toolIndex - window.playground3D.currentTool;
            window.playground3D.rotateTool(offset);
        }
    },
    
    launch: () => {
        if (window.playground3D) {
            window.playground3D.launchCurrentTool();
        }
    },
    
    rebuild: () => {
        if (window.playground3D) {
            window.playground3D.buildCarousel();
        }
    }
};