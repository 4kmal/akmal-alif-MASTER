function initializeMobileTracklist() {
    const tracklistPanel = document.getElementById('tracklist-column');
    const tracklistButton = document.querySelector('.mobile-tracklist-button');
    const swipeOverlay = document.getElementById('swipe-overlay');

    if (!tracklistPanel || !tracklistButton || !swipeOverlay) {
        // Elements not present on this page (e.g., blog page)
        console.warn('Mobile tracklist elements not found:', {
            tracklistPanel: !!tracklistPanel,
            tracklistButton: !!tracklistButton,
            swipeOverlay: !!swipeOverlay
        });
        return;
    }

    // Check if already initialized to prevent duplicate event listeners
    if (tracklistButton.getAttribute('data-listener-attached')) {
        console.log('Mobile tracklist already initialized, skipping...');
        return;
    }

    console.log('Initializing mobile tracklist functionality');
    
    // Mark that we've attached listeners to prevent duplicates
    tracklistButton.setAttribute('data-listener-attached', 'true');
    
    // Add visual feedback to confirm the button is active
    tracklistButton.style.opacity = '1';
    tracklistButton.style.pointerEvents = 'auto';

    const openPanel = () => {
        tracklistPanel.style.display = 'block'; // Show panel first
        requestAnimationFrame(() => { // Allow display to take effect
            tracklistPanel.classList.add('is-open');
            swipeOverlay.classList.add('is-active');
        });
        document.body.style.overflow = 'hidden'; // Prevent background scroll
    };

    const closePanel = () => {
        tracklistPanel.classList.remove('is-open');
        swipeOverlay.classList.remove('is-active');
        // Hide panel after animation completes
        setTimeout(() => {
            if (!tracklistPanel.classList.contains('is-open')) {
                tracklistPanel.style.display = 'none';
            }
        }, 400); // Match transition duration
        document.body.style.overflow = ''; // Restore scroll
    };

    tracklistButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Mobile tracklist button clicked!');
        
        if (tracklistPanel.classList.contains('is-open')) {
            console.log('Closing tracklist panel');
            closePanel();
        } else {
            console.log('Opening tracklist panel');
            openPanel();
        }
    });

    swipeOverlay.addEventListener('click', closePanel);

    // Swipe gesture handling
    let touchStartX = 0;
    let touchCurrentX = 0;
    const swipeThreshold = 50; // Minimum distance for a swipe

    document.addEventListener('touchstart', (e) => {
        // Start tracking only if swipe starts from the edge of the screen
        if (e.touches[0].clientX < 20) {
            touchStartX = e.touches[0].clientX;
        } else {
            touchStartX = 0; // Reset if swipe starts elsewhere
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (touchStartX > 0) { // We are in a potential swipe
            touchCurrentX = e.touches[0].clientX;
            const diffX = touchCurrentX - touchStartX;

            // Optional: partially reveal panel during swipe
            if (diffX > 0 && diffX < 280) { // 280 is panel width
                // To implement this, we'd need to remove the transition and manually set transform
            }
        }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (touchStartX > 0) {
            const diffX = touchCurrentX - touchStartX;
            if (diffX > swipeThreshold) {
                openPanel();
            }
            // Reset after swipe ends
            touchStartX = 0;
            touchCurrentX = 0;
        }
    });
    
    // Also listen for swipes to close
    tracklistPanel.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
    }, { passive: true });

    tracklistPanel.addEventListener('touchmove', (e) => {
        touchCurrentX = e.touches[0].clientX;
    }, { passive: true });

    tracklistPanel.addEventListener('touchend', (e) => {
        const diffX = touchCurrentX - touchStartX;
        if (diffX < -swipeThreshold) { // Swiped left
            closePanel();
        }
        touchStartX = 0;
        touchCurrentX = 0;
    });

    // Handle viewport changes to ensure session persistence
    window.addEventListener('resize', () => {
        const isDesktop = window.innerWidth > 768;
        console.log('Viewport change detected:', {
            width: window.innerWidth,
            isDesktop,
            panelClasses: tracklistPanel.className
        });

        if (isDesktop) {
            // Reset mobile states when switching to desktop
            console.log('Switching to desktop - resetting mobile tracklist states');
            tracklistPanel.classList.remove('is-open');
            swipeOverlay.classList.remove('is-active');
            tracklistPanel.style.display = ''; // Let CSS media queries handle
            tracklistPanel.style.transform = ''; // Reset transform
            document.body.style.overflow = ''; // Reset body scroll
        }
    });
}

// Fallback initialization - retry after a delay if initial attempt failed
function initializeMobileTracklistFallback() {
    setTimeout(() => {
        const tracklistPanel = document.getElementById('tracklist-column');
        const tracklistButton = document.querySelector('.mobile-tracklist-button');
        const swipeOverlay = document.getElementById('swipe-overlay');
        
        if (tracklistPanel && tracklistButton && swipeOverlay) {
            // Check if event listener is already attached by checking a data attribute
            if (!tracklistButton.getAttribute('data-listener-attached')) {
                console.log('Fallback: Initializing mobile tracklist functionality');
                tracklistButton.setAttribute('data-listener-attached', 'true');
                initializeMobileTracklist();
            }
        } else {
            console.log('Fallback: Mobile tracklist elements still not available');
        }
    }, 1000); // Wait 1 second for all elements to load
}

// Call fallback initialization
initializeMobileTracklistFallback(); 