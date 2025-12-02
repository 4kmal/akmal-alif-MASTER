// Simple Dynamic SVG Cursor System for Akmal's Portfolio
class CustomCursor {
    constructor() {
        this.cursor = null;
        this.cursorSvg = null;
        this.isInitialized = false;
        this.isTouch = ('ontouchstart' in window || navigator.maxTouchPoints > 0);
        
        // SVG templates - embedded for reliability
        this.svgCache = {
            pointy: {
                content: `
                    <path class="cursor-main" d="M30 25L300 295H180V355H210V415H240V470H180V415H150V355H120V325L60 385H30V25Z" fill="white"/>
                    <path class="cursor-detail" d="M59.9936 54.9997H89.9922V84.9983H59.9936V54.9997Z" fill="black"/>
                    <path class="cursor-detail" d="M89.9989 85.0042H119.998V115.003H89.9989V85.0042Z" fill="black"/>
                    <path class="cursor-detail" d="M119.993 114.999H149.992V144.997H119.993V114.999Z" fill="black"/>
                    <path class="cursor-detail" d="M149.999 145.003H179.997V175.002H149.999V145.003Z" fill="black"/>
                    <path class="cursor-detail" d="M179.993 174.998H209.992V204.996H179.993V174.998Z" fill="black"/>
                    <path class="cursor-detail" d="M209.988 205.003H239.986V235.002H209.988V205.003Z" fill="black"/>
                    <path class="cursor-detail" d="M239.991 234.997H269.99V264.996H239.991V234.997Z" fill="black"/>
                    <path class="cursor-detail" d="M29.9986 54.9993H59.9973V25.0006H29.9986V0H0V444.996H29.9986V414.994H59.9973V384.995H29.9986V54.9993Z" fill="black"/>
                    <path class="cursor-detail" d="M119.993 354.996H149.992V414.993H119.993V354.996Z" fill="black"/>
                    <path class="cursor-detail" d="M89.9989 325.002H119.998V355.001H89.9989V325.002Z" fill="black"/>
                    <path class="cursor-detail" d="M59.9936 354.996H89.9922V384.995H59.9936V354.996Z" fill="black"/>
                    <path class="cursor-detail" d="M209.988 354.996H239.986V414.993H209.988V354.996Z" fill="black"/>
                    <path class="cursor-detail" d="M239.991 414.996H269.99V469.995H239.991V414.996Z" fill="black"/>
                    <path class="cursor-detail" d="M149.999 414.996H179.997V469.995H149.999V414.996Z" fill="black"/>
                    <path class="cursor-detail" d="M179.993 470.002V500H239.995V470.002H179.993Z" fill="black"/>
                    <path class="cursor-detail" d="M329.986 325.002V295.003H299.987V265H269.989V295.003H179.988V355.001H209.987V325.002H329.986Z" fill="black"/>
                `,
                viewBox: "0 0 330 500"
            },
            hand: {
                content: `
                    <path class="cursor-hand" d="M11.8556 14.9783C19.9905 9.98527 28.1283 4.99267 36.27 0C38.6217 4.32427 40.9698 8.64602 43.3193 12.9742L18.902 27.9543C16.5506 23.6345 14.1993 19.3077 11.8556 14.9783Z" fill="white"/>
                    <path class="cursor-hand" d="M6.69073 35.4457C10.7602 32.9468 14.8273 30.4516 18.9004 27.955C37.649 62.4618 56.3953 96.9605 75.1427 131.469C71.0686 133.96 67.0015 136.455 62.9386 138.954C60.584 134.636 58.2333 130.314 55.8851 125.992C51.8091 128.479 47.7421 130.974 43.6748 133.469C41.3231 129.145 38.975 124.823 36.6248 120.498C40.692 118.002 44.7614 115.504 48.8336 113.005C34.7871 87.1525 20.7378 61.3034 6.69073 35.4457Z" fill="white"/>
                    <path class="cursor-hand" d="M43.3204 12.9739C47.3866 10.4769 51.4586 7.9788 55.531 5.4849C62.5347 18.3595 69.5191 31.2459 76.5257 44.1257C92.8065 34.1396 109.08 24.1512 125.36 14.1655C127.712 18.4897 130.059 22.8125 132.41 27.1397L120.205 34.6273C124.895 43.2793 129.606 51.9256 134.296 60.5776C130.225 63.0731 126.157 65.5682 122.092 68.0669C117.391 59.4219 112.693 50.7677 107.991 42.1181C99.8494 47.1108 91.7103 52.1042 83.5766 57.0965C88.2668 65.7484 92.979 74.3938 97.6727 83.0482C93.6009 85.5349 89.5322 88.031 85.4705 90.5366C71.4158 64.6847 57.3715 38.8242 43.322 12.9739L43.3204 12.9739Z" fill="white"/>
                    <path class="cursor-hand" d="M5.16455 122.505C13.3011 117.51 21.4373 112.519 29.579 107.526C31.9307 111.85 34.2788 116.172 36.6283 120.5C28.4866 125.493 20.3484 130.488 12.211 135.481C9.85931 131.156 7.51083 126.835 5.16455 122.505Z" fill="white"/>
                    <path class="cursor-hand" d="M163.874 25.1358C167.944 22.6369 172.011 20.1417 176.084 17.6451L211.326 82.5075C207.257 85.0125 203.19 87.5077 199.118 90.0016L163.874 25.1348L163.874 25.1358Z" fill="white"/>
                    <path class="cursor-hand" d="M0 142.972C4.06945 140.473 8.13655 137.978 12.2097 135.481L26.3054 161.424C22.2388 163.928 18.1717 166.423 14.0957 168.915C9.39593 160.269 4.6968 151.62 0 142.972Z" fill="white"/>
                    <path class="cursor-hand" d="M26.3054 161.424C30.3745 158.932 34.4432 156.433 38.5175 153.942C40.8673 158.263 43.2163 162.586 45.5674 166.914C41.5012 169.411 37.4309 171.908 33.3559 174.401C31.0024 170.073 28.654 165.751 26.3054 161.424Z" fill="white"/>
                    <path class="cursor-hand" d="M186.913 97.4905C190.976 94.9885 195.047 92.4975 199.116 90.0012L213.063 115.669C208.993 118.168 204.922 120.664 200.853 123.16C196.203 114.606 191.554 106.049 186.913 97.4905Z" fill="white"/>
                    <path class="cursor-hand" d="M90.9776 190.566C95.0457 188.072 99.1134 185.574 103.183 183.082C105.531 187.402 107.882 191.728 110.233 196.054C106.166 198.551 102.095 201.046 98.0268 203.54C95.6727 199.215 93.3246 194.893 90.9776 190.566Z" fill="white"/>
                    <path class="cursor-hand" d="M188.646 130.652C192.716 128.155 196.782 125.658 200.855 123.161L222 162.078C213.861 167.076 205.724 172.069 197.584 177.062C195.231 172.739 192.883 168.412 190.538 164.086C194.601 161.591 198.674 159.094 202.742 156.599C198.047 147.947 193.345 139.301 188.646 130.652Z" fill="white"/>
                    <path class="cursor-hand" d="M171.277 158.601C175.346 156.109 179.414 153.611 183.482 151.113C185.833 155.438 188.182 159.764 190.538 164.086C186.464 166.588 182.394 169.082 178.325 171.578C175.972 167.255 173.622 162.929 171.277 158.601Z" fill="white"/>
                    <path class="cursor-hand" d="M132.406 27.1424C140.543 22.1501 148.68 17.156 156.823 12.1623L163.872 25.1365L151.668 32.6242C154.015 36.9514 156.359 41.2752 158.709 45.6034C154.641 48.0969 150.572 50.593 146.507 53.0917C141.803 44.4432 137.102 35.7904 132.406 27.1424Z" fill="white"/>
                    <path class="cursor-hand" d="M99.5599 116.483C103.628 113.983 107.697 111.487 111.77 108.993L139.815 160.61L127.605 168.101L99.5599 116.483Z" fill="white"/>
                    <path class="cursor-hand" d="M123.975 101.505C128.041 99.0061 132.113 96.508 136.185 94.0141L164.23 145.631L152.02 153.122C142.671 135.915 133.321 118.71 123.975 101.505Z" fill="white"/>
                    <path class="cursor-hand" d="M148.395 86.5234C152.465 84.035 156.532 81.5355 160.598 79.0368C169.95 96.2419 179.296 113.451 188.647 130.657C184.576 133.155 180.509 135.65 176.441 138.143C167.087 120.942 157.738 103.736 148.396 86.5261L148.395 86.5234Z" fill="white"/>
                    <path class="cursor-hand" d="M45.5648 166.909C49.6352 164.412 53.7004 161.913 57.7729 159.419C62.4251 167.974 67.0692 176.529 71.7196 185.08C75.7904 182.592 79.8591 180.096 83.9273 177.602C86.279 181.926 88.6271 186.248 90.977 190.569C86.9084 193.07 82.8404 195.563 78.7673 198.06C76.4666 193.829 74.1677 189.598 71.868 185.369C67.7999 187.863 63.7284 190.354 59.6562 192.852C54.9615 184.208 50.2616 175.557 45.5648 166.909Z" fill="white"/>
                    <path class="cursor-hand" d="M110.235 196.056C114.301 193.559 118.37 191.063 122.444 188.568C124.791 192.888 127.143 197.214 129.498 201.532C145.775 191.551 162.05 181.562 178.33 171.576C180.679 175.897 183.029 180.221 185.377 184.552L124.337 222C119.633 213.35 114.932 204.706 110.236 196.056L110.235 196.056Z" fill="white"/>
                `,
                viewBox: "0 0 222 222"
            }
        };
        
        this.currentCursor = 'pointy';
        
        this.init();
        this.bindEvents();
    }
    
    init() {
        // Don't initialize on touch devices
        if (this.isTouch) return;
        
        // Create cursor elements
        this.createCursorElements();
        
        // Hide default cursor
        this.hideDefaultCursor();
        
        this.isInitialized = true;
        console.log('Simple dynamic cursor initialized');
    }
    
    createCursorElements() {
        // Create main cursor container
        this.cursor = document.createElement('div');
        this.cursor.className = 'custom-cursor';
        
        // Create SVG cursor element
        this.cursorSvg = document.createElement('div');
        this.cursorSvg.className = 'cursor-svg';
        
        // Set initial cursor
        this.setCursorType('pointy');
        
        this.cursor.appendChild(this.cursorSvg);
        
        // Insert cursor into DOM
        document.body.appendChild(this.cursor);
        
        // Add cursor styles
        this.addCursorStyles();
    }
    
    setCursorType(type) {
        if (!this.svgCache[type] || !this.cursorSvg) return;
        
        const svgData = this.svgCache[type];
        this.currentCursor = type;
        
        // Update SVG content
        this.cursorSvg.innerHTML = `
            <svg width="33" height="50" viewBox="${svgData.viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">
                ${svgData.content}
            </svg>
        `;
        
        // Update cursor class for specific styling
        this.cursor.className = `custom-cursor cursor-${type}`;
    }
    
    addCursorStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Hide default cursor globally */
            *, *:before, *:after {
                cursor: none !important;
            }
            
            /* Custom cursor container */
            .custom-cursor {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 9999;
            }
            
            /* SVG cursor */
            .cursor-svg {
                position: fixed;
                width: 33px;
                height: 50px;
                transform: translate(0, 0);
                transition: transform 0.15s cubic-bezier(0.23, 1, 0.32, 1);
                z-index: 10001;
                will-change: transform;
            }
            
            .cursor-svg svg {
                width: 100%;
                height: 100%;
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
            }
            
            /* Cursor states for both types - no color changes, original SVG colors preserved */
            .cursor-main, .cursor-detail, .cursor-hand {
                transition: transform 0.3s ease;
            }
            
            /* Default pointy cursor states */
            .cursor-pointy.hover .cursor-svg {
                transform: translate(0, 0) scale(1.2);
            }
            
            .cursor-pointy.click .cursor-svg {
                transform: translate(0, 0) scale(0.9);
            }
            
            .cursor-pointy.text .cursor-svg {
                transform: translate(0, 0) scale(1.1);
            }
            
            /* Hand cursor states */
            .cursor-hand .cursor-svg {
                transform: translate(0, 0) scale(1.1);
            }
            
            .cursor-hand.hover .cursor-svg {
                transform: translate(0, 0) scale(1.3);
            }
            
            .cursor-hand.click .cursor-svg {
                transform: translate(0, 0) scale(1.0);
            }
            
            /* Loading state for both */
            .custom-cursor.loading .cursor-svg {
                animation: cursorPulse 1s ease-in-out infinite;
            }
            
            /* Hidden state */
            .custom-cursor.hidden {
                opacity: 0;
            }
            
            /* Animations */
            @keyframes cursorPulse {
                0%, 100% { 
                    transform: translate(0, 0) scale(1);
                    opacity: 1;
                }
                50% { 
                    transform: translate(0, 0) scale(1.15);
                    opacity: 0.8;
                }
            }
            
            /* Smooth cursor movement */
            .cursor-svg {
                transition: transform 0.1s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            }
            
            /* Responsive scaling */
            @media (max-width: 768px) {
                .cursor-svg {
                    width: 28px;
                    height: 42px;
                }
            }
            
            @media (max-width: 480px) {
                .cursor-svg {
                    width: 24px;
                    height: 36px;
                }
            }
        `;
        
        document.head.appendChild(style);
    }
    
    hideDefaultCursor() {
        document.documentElement.style.cursor = 'none';
        document.body.style.cursor = 'none';
    }
    
    bindEvents() {
        if (this.isTouch || !this.isInitialized) return;
        
        // Mouse movement with smooth tracking
        let mouseX = 0, mouseY = 0;
        let cursorX = 0, cursorY = 0;
        
        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        });
        
        // Smooth cursor following animation
        const updateCursorPosition = () => {
            const dx = mouseX - cursorX;
            const dy = mouseY - cursorY;
            
            cursorX += dx * 0.15; // Smooth following factor
            cursorY += dy * 0.15;
            
            if (this.cursorSvg) {
                this.cursorSvg.style.left = `${cursorX}px`;
                this.cursorSvg.style.top = `${cursorY}px`;
            }
            
            requestAnimationFrame(updateCursorPosition);
        };
        
        updateCursorPosition();
        
        // Mouse enter/leave window
        document.addEventListener('mouseenter', () => this.showCursor());
        document.addEventListener('mouseleave', () => this.hideCursor());
        
        // Mouse states
        document.addEventListener('mousedown', () => this.setCursorState('click'));
        document.addEventListener('mouseup', () => this.removeCursorState('click'));
        
        // Hover states for interactive elements
        this.bindHoverEvents();
        
        // Page visibility
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.hideCursor();
            } else {
                this.showCursor();
            }
        });
    }
    
    bindHoverEvents() {
        // Link-specific hover events (use hand cursor)
        document.addEventListener('mouseover', (e) => {
            if (e.target.matches('a, .nav-link')) {
                this.setCursorType('hand');
                this.setCursorState('hover');
            }
            // Other interactive elements (keep pointy cursor)
            else if (e.target.matches('button, input, textarea, select, [role="button"], [tabindex], .clickable, .btn, .tool-card, .blog-card, .playground-tool-card, .playground-info-control, .playground-launch-button, .creative-letter')) {
                this.setCursorType('pointy');
                this.setCursorState('hover');
            }
            // Text elements
            else if (e.target.matches('p, h1, h2, h3, h4, h5, h6, span, .post-excerpt') && !e.target.matches('a, button')) {
                this.setCursorType('pointy');
                this.setCursorState('text');
            }
        });
        
        document.addEventListener('mouseout', (e) => {
            if (e.target.matches('a, .nav-link')) {
                this.setCursorType('pointy');
                this.removeCursorState('hover');
            }
            else if (e.target.matches('button, input, textarea, select, [role="button"], [tabindex], .clickable, .btn, .tool-card, .blog-card, .playground-tool-card, .playground-info-control, .playground-launch-button, .creative-letter')) {
                this.removeCursorState('hover');
            }
            else if (e.target.matches('p, h1, h2, h3, h4, h5, h6, span, .post-excerpt') && !e.target.matches('a, button')) {
                this.removeCursorState('text');
            }
        });
    }
    
    setCursorState(state) {
        if (!this.cursor) return;
        this.cursor.classList.add(state);
    }
    
    removeCursorState(state) {
        if (!this.cursor) return;
        this.cursor.classList.remove(state);
    }
    
    showCursor() {
        if (!this.cursor) return;
        this.cursor.classList.remove('hidden');
    }
    
    hideCursor() {
        if (!this.cursor) return;
        this.cursor.classList.add('hidden');
    }
    
    setLoadingState() {
        this.setCursorState('loading');
    }
    
    removeLoadingState() {
        this.removeCursorState('loading');
    }
    
    destroy() {
        if (this.cursor) {
            this.cursor.remove();
        }
        
        // Restore default cursor
        document.documentElement.style.cursor = '';
        document.body.style.cursor = '';
        
        console.log('Dynamic cursor destroyed');
    }
}

// Initialize custom cursor when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Only initialize if not on mobile/touch device
    if (!('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
        window.customCursor = new CustomCursor();
        console.log('Dynamic cursor system loaded');
    }
});

// Export for manual initialization if needed
window.CustomCursor = CustomCursor;