const seconds = document.querySelector(".seconds .number"),
  minutes = document.querySelector(".minutes .number"),
  hours = document.querySelector(".hours .number"),
  days = document.querySelector(".days .number");

const DEBUG_APP = false;
const debugLog = (...args) => {
    if (DEBUG_APP) console.log(...args);
};

// Check if timer elements exist before starting the timer
if (days && seconds && minutes && hours) {
let secValue = 11,
  minValue = 2,
  hourValue = 2,
  dayValue = 9;

const timeFunction = setInterval(() => {
  secValue--;

  if (secValue === 0) {
    minValue--;
    secValue = 60;
  }
  if (minValue === 0) {
    hourValue--;
    minValue = 60;
  }
  if (hourValue === 0) {
    dayValue--;
    hourValue = 24;
  }

  if (dayValue === 0) {
    clearInterval(timeFunction);
  }
    // Null check already implicitly handled by the outer 'if'
  seconds.textContent = secValue < 10 ? `0${secValue}` : secValue;
  minutes.textContent = minValue < 10 ? `0${minValue}` : minValue;
  hours.textContent = hourValue < 10 ? `0${hourValue}` : hourValue;
  days.textContent = dayValue < 10 ? `0${dayValue}` : dayValue;
}, 1000); //1000ms = 1s
}

// Disable right-click
document.addEventListener('contextmenu', e => e.preventDefault());

// ========== ANIMATED GRID BACKGROUND ==========
// Background is now loaded via reusable partial: partials/animated-grid-background.html

// Enhanced mouse movement animation logic has been integrated directly
// into the partials/animated-grid-background.html file

// ----- PATH CONFIGURATION FOR HTML PARTIALS -----
// Smart path resolution that works from any subdirectory
function getBasePath() {
    // Get the current page's path
    const currentPath = window.location.pathname;
    const fullURL = window.location.href;
    const pathWithoutIndex = currentPath.replace(/\/index\.html$/, '/');
    
    debugLog('🌐 Path Resolution Debug:', {
        fullURL,
        pathname: currentPath,
        host: window.location.host,
        protocol: window.location.protocol
    });
    
    // For blog pages, we need to go up one level with '../'
    if (pathWithoutIndex.includes('/blog/')) {
        debugLog('📝 Detected blog page, using "../" base path');
        return '../';
    }
    
    // Check if we're in any subdirectory by counting slashes
    const pathSegments = pathWithoutIndex.split('/').filter(segment => 
        segment && 
        !segment.endsWith('.html')
    );
    
    debugLog(`📁 Path segments after filtering:`, pathSegments);
    
    if (pathSegments.length > 0) {
        // We're in a subdirectory, need to go up
        const levels = pathSegments.length;
        const basePath = '../'.repeat(levels);
        debugLog(`📂 Detected ${levels} level(s) deep, using "${basePath}" base path`);
        return basePath;
    }
    
    // For root level pages, use current directory
    debugLog('🏠 At root level, using "./" base path');
    return './';
}

const BASE_PATH = getBasePath();

// -------- PATH RESOLUTION FOR LOADED PARTIALS --------
function fixPartialPaths(container, basePath) {
    if (!container) {
        console.warn('fixPartialPaths: container is null or undefined');
        return;
    }
    
    debugLog(`🔧 Starting path fixing with base path: "${basePath}"`);
    debugLog(`🔍 Container:`, container);
    debugLog(`📍 Current location: ${window.location.pathname}`);
    
    // Helper function to fix a path
    function fixPath(originalPath) {
        // Only fix paths that start with './' 
        if (originalPath && originalPath.startsWith('./')) {
            const newPath = originalPath.replace('./', basePath);
            debugLog(`✅ Path fix: "${originalPath}" -> "${newPath}"`);
            return newPath;
        }
        debugLog(`❌ Skipping path (doesn't start with './'): "${originalPath}"`);
        return originalPath;
    }
    
    let fixedCount = 0;
    
    // Fix img src attributes
    const images = container.querySelectorAll('img[src^="./"]');
    debugLog(`🖼️ Found ${images.length} images to fix`);
    images.forEach((img, index) => {
        const originalSrc = img.getAttribute('src');
        const newSrc = fixPath(originalSrc);
        img.setAttribute('src', newSrc);
        debugLog(`   Image ${index + 1}: ${originalSrc} -> ${newSrc}`);
        
        // Test if the image loads correctly
        img.addEventListener('load', () => {
            debugLog(`✅ Image loaded successfully: ${newSrc}`);
        });
        img.addEventListener('error', () => {
            console.error(`❌ Image failed to load: ${newSrc}`);
        });
        
        fixedCount++;
    });
    
    // Fix link href attributes  
    const links = container.querySelectorAll('a[href^="./"]');
    debugLog(`🔗 Found ${links.length} links to fix`);
    links.forEach((link, index) => {
        const originalHref = link.getAttribute('href');
        const newHref = fixPath(originalHref);
        link.setAttribute('href', newHref);
        debugLog(`   Link ${index + 1}: ${originalHref} -> ${newHref}`);
        fixedCount++;
    });
    
    // Fix script src attributes (if any)
    const scripts = container.querySelectorAll('script[src^="./"]');
    debugLog(`📜 Found ${scripts.length} scripts to fix`);
    scripts.forEach((script, index) => {
        const originalSrc = script.getAttribute('src');
        const newSrc = fixPath(originalSrc);
        script.setAttribute('src', newSrc);
        debugLog(`   Script ${index + 1}: ${originalSrc} -> ${newSrc}`);
        fixedCount++;
    });
    
    // Fix link href attributes for stylesheets (if any)
    const stylesheets = container.querySelectorAll('link[href^="./"]');
    debugLog(`🎨 Found ${stylesheets.length} stylesheets to fix`);
    stylesheets.forEach((link, index) => {
        const originalHref = link.getAttribute('href');
        const newHref = fixPath(originalHref);
        link.setAttribute('href', newHref);
        debugLog(`   Stylesheet ${index + 1}: ${originalHref} -> ${newHref}`);
        fixedCount++;
    });
    
    // Fix any other data-src attributes
    const elementsWithDataSrc = container.querySelectorAll('[data-src^="./"]');
    debugLog(`📊 Found ${elementsWithDataSrc.length} data-src elements to fix`);
    elementsWithDataSrc.forEach((element, index) => {
        const originalDataSrc = element.getAttribute('data-src');
        const newDataSrc = fixPath(originalDataSrc);
        element.setAttribute('data-src', newDataSrc);
        debugLog(`   Data-src ${index + 1}: ${originalDataSrc} -> ${newDataSrc}`);
        fixedCount++;
    });
    
    // Also fix any images without src that start with "./" (might be lazy loaded)
    const allImages = container.querySelectorAll('img');
    allImages.forEach(img => {
        if (!img.getAttribute('src') || img.getAttribute('src') === '') {
            const dataSrc = img.getAttribute('data-src');
            if (dataSrc && dataSrc.startsWith('./')) {
                const newDataSrc = fixPath(dataSrc);
                img.setAttribute('data-src', newDataSrc);
                debugLog(`   Fixed lazy image data-src: ${dataSrc} -> ${newDataSrc}`);
                fixedCount++;
            }
        }
    });
    
    debugLog(`🏁 Path fixing complete! Fixed ${fixedCount} relative paths in partial`);
    
    // Log all remaining images for debugging
    const allImagesAfter = container.querySelectorAll('img');
    debugLog(`🔍 All images after fixing:`, Array.from(allImagesAfter).map(img => ({
        element: img,
        src: img.getAttribute('src'),
        dataSrc: img.getAttribute('data-src'),
        alt: img.getAttribute('alt')
    })));
}

// -------- COMMON INITIALIZATION AFTER PARTIAL LOAD --------
function executePartialLoadCallback(placeholderId, callback) {
    // Fix relative paths in the loaded partial
    const container = document.getElementById(placeholderId);
    fixPartialPaths(container, BASE_PATH);
    
    // Special handling for specific partials
    if (placeholderId === 'site-header-placeholder') {
        setupDarkModeToggles();
    }

    if (callback && typeof callback === 'function') {
        callback(); // Execute original callback if one was provided
    }

    // Initialize the mobile menu functionality
    if (typeof initializeNewMobileMenu === 'function') {
        initializeNewMobileMenu();
    }

    // Initialize the mobile tracklist functionality
    if (typeof initializeMobileTracklist === 'function') {
        initializeMobileTracklist();
    }
}

// -------- FUNCTION TO LOAD HTML PARTIALS --------
async function loadHtmlPartial(filePath, placeholderId, callback) {
    const fullPath = BASE_PATH + filePath; // Assumes BASE_PATH is globally available
    
    debugLog(`🚀 Loading HTML partial: ${filePath}`);
    debugLog(`   Target placeholder: ${placeholderId}`);
    debugLog(`   Full path: ${fullPath}`);
    
    try {
        const response = await fetch(fullPath);
        if (!response.ok) {
            // If the primary path fails, try with different base paths as fallback
            console.warn(`❌ Primary path failed (${fullPath}), trying fallback paths...`);
            
            const fallbackPaths = ['./' + filePath, '../' + filePath, '../../' + filePath];
            
            for (const fallbackPath of fallbackPaths) {
                try {
                    debugLog(`🔄 Trying fallback path: ${fallbackPath}`);
                    const fallbackResponse = await fetch(fallbackPath);
                    if (fallbackResponse.ok) {
                        debugLog(`✅ Success with fallback path: ${fallbackPath}`);
                        const text = await fallbackResponse.text();
                        const placeholder = document.getElementById(placeholderId);
                        if (placeholder) {
                            placeholder.innerHTML = text;
                            
                            // Execute common initialization logic with the successful path base
                            const successfulBasePath = fallbackPath.replace(filePath, '');
                            debugLog(`🔧 Using successful base path for fixing: ${successfulBasePath}`);
                            fixPartialPaths(placeholder, successfulBasePath);
                            
                            // Execute other callbacks
                            if (callback && typeof callback === 'function') {
                                callback();
                            }
                            
                            // Special handling for specific partials
                            if (placeholderId === 'site-header-placeholder') {
                                setupDarkModeToggles();
                            }

                            // Initialize mobile functionality
                            if (typeof initializeNewMobileMenu === 'function') {
                                initializeNewMobileMenu();
                            }
                            if (typeof initializeMobileTracklist === 'function') {
                                initializeMobileTracklist();
                            }
                        }
                        return; // Success, exit the function
                    }
                } catch (fallbackError) {
                    debugLog(`❌ Fallback path ${fallbackPath} also failed:`, fallbackError);
                }
            }
            
            // If all fallback paths fail, throw the original error
            throw new Error(`Failed to fetch ${fullPath}: ${response.status} ${response.statusText}`);
        }
        // Success with primary path
        debugLog(`✅ Primary path success: ${fullPath}`);
        const text = await response.text();
        const placeholder = document.getElementById(placeholderId);
        if (placeholder) {
            placeholder.innerHTML = text;
            
            // Execute common initialization logic
            executePartialLoadCallback(placeholderId, callback);
        } else {
            console.warn(`⚠️ Placeholder with ID '${placeholderId}' not found for path '${fullPath}'.`);
        }
    } catch (error) {
        console.error(`💥 Error loading partial ${filePath}:`, error);
        console.error(`   Attempted to load from: ${fullPath}`);
        console.error(`   Current page path: ${window.location.pathname}`);
        console.error(`   Base path calculated as: ${BASE_PATH}`);
        
        const placeholder = document.getElementById(placeholderId);
        if (placeholder) {
            placeholder.innerHTML = `
                <p style="color:red; font-size: 12px; padding: 10px; background: rgba(255,0,0,0.1); border-radius: 4px;">
                    <strong>Header Loading Error:</strong><br>
                    Could not load ${filePath}<br>
                    <small>Tried path: ${fullPath}</small>
                </p>
            `;
        }
    }
}

// -------- Import Modular Music Player System --------
// Load music player modules
async function loadMusicPlayerModules() {
    try {
        if (window.playerIntegration?.init) {
            await window.playerIntegration.init();
        } else if (!window.persistentPlayer) {
            throw new Error('Persistent music player was not loaded by the module script.');
        }
        
    } catch (error) {
        console.error('Failed to load music player modules:', error);
        console.error('Error details:', error);
        // Fallback to basic music player if modules fail
        initBasicMusicPlayer();
    }
}

// Basic fallback music player (simplified version of the old system)
function initBasicMusicPlayer() {
    const playPauseBtn = document.getElementById('playPauseBtn');
    const audio = document.getElementById('audioPlayer1');
    
    if (playPauseBtn && audio) {
        playPauseBtn.addEventListener('click', () => {
            if (audio.paused) {
                audio.play().catch(e => console.error('Play failed:', e));
            } else {
                audio.pause();
            }
        });
        
        audio.addEventListener('play', () => {
            const playIcon = document.getElementById('playIcon');
            const pauseIcon = document.getElementById('pauseIcon');
            if (playIcon && pauseIcon) {
                playIcon.style.display = 'none';
                pauseIcon.style.display = 'block';
            }
        });
        
        audio.addEventListener('pause', () => {
            const playIcon = document.getElementById('playIcon');
            const pauseIcon = document.getElementById('pauseIcon');
            if (playIcon && pauseIcon) {
                playIcon.style.display = 'block';
                pauseIcon.style.display = 'none';
            }
        });
    }
}

// -------- Vinyl Coverflow --------
let currentCoverIndex;
const today = new Date().toISOString().slice(0, 10);
const savedDate = localStorage.getItem('dailyCoverDate');
const savedIndex = parseInt(localStorage.getItem('dailyCoverIndex'), 10);

function initVinylCoverflow() {
    const covers = Array.from(document.querySelectorAll('.cover'));
    const albumInfo = document.getElementById('album-info');
    const coverflow = document.getElementById('coverflow');
    
    if (!covers.length || !albumInfo || !coverflow) {
        console.error("Vinyl coverflow elements not found!");
        return;
    }
    
    if (savedDate === today && !isNaN(savedIndex) && savedIndex >= 0 && savedIndex < covers.length) {
        currentCoverIndex = savedIndex;
    } else {
        currentCoverIndex = Math.floor(Math.random() * covers.length);
        localStorage.setItem('dailyCoverIndex', currentCoverIndex);
        localStorage.setItem('dailyCoverDate', today);
    }
    
    function updateCoverflow() {
        if (!covers.length || !albumInfo) return;
        const m = window.innerWidth <= 600;
        covers.forEach((c, i) => {
            const o = i - currentCoverIndex; const d = Math.abs(o);
            const txM = m ? 80 : 100; const tzM = m ? 70 : 150; const sM = 0.15; const a = m ? 60 : 70;
            const tx = o * txM; const ry = o < 0 ? a : (o > 0 ? -a : 0); const s = Math.max(0, 1 - d * sM); const tz = -tzM * d;
            c.style.zIndex = 100 - d; c.style.transform = `translateX(${tx}px) translateZ(${tz}px) rotateY(${ry}deg) scale(${s})`;
            c.classList.toggle('active', o === 0); c.style.opacity = o === 0 ? 1 : 0.7;
        });
        const ac = covers[currentCoverIndex];
        albumInfo.innerHTML = ac?.dataset.album ? `<strong>${ac.dataset.album}</strong>` : "";
    }
    
    coverflow.addEventListener('wheel', e => {
        e.preventDefault();
        const d = e.deltaY > 0 ? 1 : -1;
        currentCoverIndex = (currentCoverIndex + d + covers.length) % covers.length;
        updateCoverflow();
    }, { passive: false });
    
    let touchStartX = 0;
    let isDraggingVinyl = false;
    
    coverflow.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        isDraggingVinyl = true;
        coverflow.style.cursor = 'grabbing';
    }, { passive: true });
    
    coverflow.addEventListener('touchmove', e => {
        if (!isDraggingVinyl) return;
    }, { passive: true });
    
    coverflow.addEventListener('touchend', e => {
        if (!isDraggingVinyl) return;
        isDraggingVinyl = false;
        coverflow.style.cursor = 'grab';
        const teX = e.changedTouches[0].screenX;
        const df = touchStartX - teX;
        if (Math.abs(df) > 50) {
            const d = df > 0 ? 1 : -1;
            currentCoverIndex = (currentCoverIndex + d + covers.length) % covers.length;
            updateCoverflow();
        }
    });
    
    coverflow.addEventListener('touchcancel', () => {
        if (isDraggingVinyl) isDraggingVinyl = false;
        coverflow.style.cursor = 'grab';
    });
    
    let isMouseDown = false;
    let startMouseX = 0;
    
    coverflow.addEventListener('mousedown', (e) => {
        isMouseDown = true;
        startMouseX = e.clientX;
        coverflow.style.cursor = 'grabbing';
    });
    
    coverflow.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
    });
    
    coverflow.addEventListener('mouseup', (e) => {
        if (!isMouseDown) return;
        const moveX = e.clientX - startMouseX;
        if (Math.abs(moveX) > 50) {
            const d = moveX < 0 ? 1 : -1;
            currentCoverIndex = (currentCoverIndex + d + covers.length) % covers.length;
            updateCoverflow();
        }
        isMouseDown = false;
        coverflow.style.cursor = 'grab';
    });
    
    coverflow.addEventListener('mouseleave', () => {
        if (isMouseDown) {
            isMouseDown = false;
            coverflow.style.cursor = 'grab';
        }
    });
    
    updateCoverflow();
    
    return updateCoverflow;
}

let updateCoverflowFn = null;

window.addEventListener('resize', () => {
    if (updateCoverflowFn) {
        updateCoverflowFn();
    }
    
    // Handle session persistence for tracklist panel between viewport changes
    const tracklistPanel = document.getElementById('tracklist-column');
    const swipeOverlay = document.getElementById('swipe-overlay');
    const isDesktop = window.innerWidth > 768;
    
    if (tracklistPanel && swipeOverlay) {
        if (isDesktop) {
            debugLog('📱➡️🖥️ Viewport changed to desktop - ensuring tracklist visibility');
            
            // Reset all mobile-specific states and styles
            tracklistPanel.classList.remove('is-open');
            swipeOverlay.classList.remove('is-active');
            
            // Clear inline styles that might override CSS media queries
            tracklistPanel.style.display = '';
            tracklistPanel.style.transform = '';
            tracklistPanel.style.left = '';
            tracklistPanel.style.top = '';
            tracklistPanel.style.width = '';
            tracklistPanel.style.height = '';
            
            // Reset body styles
            document.body.style.overflow = '';
            document.body.classList.remove('mobile-menu-open');
            
            debugLog('✅ Desktop tracklist reset complete');
        } else {
            debugLog('🖥️➡️📱 Viewport changed to mobile');
            // Ensure mobile tracklist starts closed
            tracklistPanel.classList.remove('is-open');
            swipeOverlay.classList.remove('is-active');
            tracklistPanel.style.display = 'none'; // Hide by default on mobile
            document.body.style.overflow = '';
        }
    }
});

// -------- Links Scroller --------
const linksContainer = document.getElementById('linksContainer');
const linksInner = document.getElementById('linksInner');
let isDraggingLinks = false; let startX_links; let scrollLeftStart_links;
function updateLinksScrollableState() {
    if (linksContainer) {
        linksContainer.classList.toggle('is-scrollable', linksContainer.scrollWidth > linksContainer.clientWidth + 1);
    }
}
if (linksContainer) { // Added check
    linksContainer.addEventListener('mousedown', (e) => { isDraggingLinks = true; startX_links = e.pageX - linksContainer.offsetLeft; scrollLeftStart_links = linksContainer.scrollLeft; linksContainer.style.cursor = 'grabbing'; });
    linksContainer.addEventListener('mouseleave', () => { if (isDraggingLinks) { isDraggingLinks = false; linksContainer.style.cursor = 'grab'; } });
    linksContainer.addEventListener('mouseup', () => { if (isDraggingLinks) { isDraggingLinks = false; linksContainer.style.cursor = 'grab'; } });
    linksContainer.addEventListener('mousemove', (e) => { if (!isDraggingLinks) return; e.preventDefault(); const x = e.pageX - linksContainer.offsetLeft; const walk = (x - startX_links) * 1.5; linksContainer.scrollLeft = scrollLeftStart_links - walk; });
    linksContainer.addEventListener('wheel', (e) => { if (linksContainer.scrollWidth > linksContainer.clientWidth) { e.preventDefault(); linksContainer.scrollLeft += e.deltaY * 0.5; } }, { passive: false });
    linksContainer.addEventListener('scroll', updateLinksScrollableState, { passive: true });
}
function debounce(f, w) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f.apply(this, a), w); }; };
const handleResizeLinks = debounce(() => { updateLinksScrollableState(); }, 250);
window.addEventListener('resize', handleResizeLinks);

// -------- Dark Mode --------
const darkToggle = document.getElementById('darkToggle');
const body = document.body;
function applyDarkMode(isDark) {
    const enabled = Boolean(isDark);
    document.documentElement.classList.toggle('dark', enabled);
    if (body) body.classList.toggle('dark', enabled);
    localStorage.setItem('theme', enabled ? 'dark' : 'light');
    localStorage.setItem('darkMode', String(enabled));
    updateLinksScrollableState(); // Call this after class change
}

function setupDarkModeToggles() {
    const toggles = document.querySelectorAll('.dark-mode-toggle');
    // Default to dark mode if no preference is saved (first visit)
    const darkModeSetting = localStorage.getItem('darkMode');
    const savedDarkMode = darkModeSetting === null ? true : darkModeSetting === 'true';
    
    applyDarkMode(savedDarkMode);

    toggles.forEach(toggle => {
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            applyDarkMode(!document.body.classList.contains('dark'));
        });
    });
}

// -------- Empty Link Popup (Single Popup Logic) --------
function setupEmptyLinkPopups() {
    const linksInner = document.getElementById('linksInner');
    if (!linksInner) return;

    linksInner.addEventListener('click', function(e) {
        const link = e.target.closest('a[href="#"]');
        if (!link) return;

        e.preventDefault();
        
        // Track empty link click
        if (window.analytics) {
            const linkText = link.querySelector('span')?.textContent || 'unknown';
            window.analytics.trackNavigation('empty_link_' + linkText.toLowerCase());
        }

        let tooltip = link.querySelector('.empty-popup');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'empty-popup';
            tooltip.textContent = 'link OTW🫡';
            link.appendChild(tooltip);
        }

        // Clear any existing timeout
        if (tooltip.dataset.timeoutId) {
            clearTimeout(tooltip.dataset.timeoutId);
        }

        // Force reflow to restart animation if already shown
        tooltip.classList.remove('show');
        void tooltip.offsetWidth; // Trigger reflow
        tooltip.classList.add('show');

        // Set a timeout to hide the tooltip
        tooltip.dataset.timeoutId = setTimeout(() => {
            tooltip.classList.remove('show');
        }, 1000);
    });
}

// Call the function when the DOM is ready
document.addEventListener('DOMContentLoaded', setupEmptyLinkPopups);

// -------- New Dynamic Text Animation --------
function initNewDynamicTextAnimation() {
    const dynamicTextContainer = document.querySelector('.typing-effect .dynamic-text-wrapper');
    const dynamicTextList = document.querySelector('.typing-effect .dynamic-text');

    if (!dynamicTextContainer || !dynamicTextList) {
        console.warn("Dynamic text animation elements not found.");
        return;
    }

    const items = Array.from(dynamicTextList.children);
    if (items.length === 0) return;

    const itemHeight = items[0].offsetHeight;
    const animationInterval = 2500; // Time each item is active (milliseconds)
    const visibleNeighborCount = 1; // Number of items to show above/below with reduced opacity (e.g., 1 means 1 above, 1 below)

    let currentIndex = 0;
    let intervalId = null;

    // Ensure wrapper has a defined height to clip overflow
    dynamicTextContainer.style.height = `${itemHeight * (1 + 2 * visibleNeighborCount)}px`;
    dynamicTextContainer.style.overflow = 'hidden';

    function updateTextItems() {
        // Calculate the translateY for the <ul> to center the current item
        // The wrapper shows (1 + 2 * visibleNeighborCount) items.
        // The active one should be in the middle.
        const translateY = -(currentIndex * itemHeight) + (itemHeight * visibleNeighborCount);
        dynamicTextList.style.transform = `translateY(${translateY}px)`;

        items.forEach((item, index) => {
            item.classList.remove('active-text-item', 'visible-neighbor');

            if (index === currentIndex) {
                item.classList.add('active-text-item');
            } else {
                // Determine if it's a visible neighbor
                let diff = Math.abs(index - currentIndex);
                // Handle wrap-around for neighbors (if list is not long enough)
                if (items.length > (1 + 2 * visibleNeighborCount)) { // Only wrap if there are enough items to make wrapping meaningful
                    if (diff > items.length / 2) {
                        diff = items.length - diff;
                    }
                }

                if (diff <= visibleNeighborCount) {
                    item.classList.add('visible-neighbor');
                }
            }
        });

        currentIndex = (currentIndex + 1) % items.length;
    }

    // Clear existing interval if any (e.g., during hot-reloads or re-init)
    if (dynamicTextList.dataset.intervalId) {
        clearInterval(parseInt(dynamicTextList.dataset.intervalId));
    }

    if (items.length > 1) {
        // Apply a transition for smooth scrolling. Adjust timing and easing as needed.
        dynamicTextList.style.transition = 'transform 0.6s cubic-bezier(0.68, -0.55, 0.27, 1.55)'; // Example easing
        updateTextItems(); // Initial call to set first item
        intervalId = setInterval(updateTextItems, animationInterval);
        dynamicTextList.dataset.intervalId = String(intervalId); // Store interval ID for potential clearing
    } else if (items.length === 1) {
        // If only one item, just make it active and center it
        items[0].classList.add('active-text-item');
        dynamicTextList.style.transform = `translateY(${itemHeight * visibleNeighborCount}px)`;
    }
}

// -------- Blog Outline/Table of Contents Generator --------
// ... existing code ...

// Call the function when the DOM is ready
document.addEventListener('DOMContentLoaded', initNewDynamicTextAnimation);

// -------- MAIN DOMCONTENTLOADED LISTENER --------
// Remove any other DOMContentLoaded listeners for functions called below
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Load the animated background first (non-blocking)
        // The enhanced mouse movement logic is now integrated directly in the HTML partial
        loadHtmlPartial('partials/animated-grid-background.html', 'animated-background-placeholder');
        
        // Load the header first as it's critical for navigation
        await loadHtmlPartial('partials/site-header.html', 'site-header-placeholder', () => {
            // Now that the header is loaded, initialize its dark mode toggle
            // and other header-specific functionalities.
            const headerDarkToggle = document.getElementById('headerDarkToggle');
            if (headerDarkToggle) {
                headerDarkToggle.addEventListener('click', (event) => {
                    event.stopPropagation(); // Prevent card from getting click
                    applyDarkMode(!document.body.classList.contains('dark'));
                });
            }
            
            // Initialize the mobile menu functionality
            if (typeof initializeNewMobileMenu === 'function') {
                initializeNewMobileMenu();
            }
        });

        // Load independent page partials in parallel to reduce first-render layout shift.
        await Promise.all([
            loadHtmlPartial('partials/music-player-section.html', 'music-player-section-placeholder'),
            loadHtmlPartial('partials/vinyl-section.html', 'vinyl-section-placeholder'),
            loadHtmlPartial('partials/bento/bento-tracklist.html', 'tracklist-panel-placeholder'),
            loadHtmlPartial('partials/bento/bento-clock.html', 'clock-widget-placeholder')
        ]);
        document.dispatchEvent(new CustomEvent('profile-metrics:targets-ready'));

        // Initialize other functions that depend on the full DOM / loaded partials
        setupDarkModeToggles();
        
        // Initialize enhanced bento anchoring system
        initBentoAnchoring();

        if (typeof initNewDynamicTextAnimation === 'function') {
            initNewDynamicTextAnimation();
        } else {
            console.warn("'initNewDynamicTextAnimation' function is not defined.");
        }

        if (typeof initVinylCoverflow === 'function') {
            updateCoverflowFn = initVinylCoverflow(); // Assuming initVinylCoverflow returns the update function
        } else {
            console.warn("'initVinylCoverflow' function is not defined.");
        }

        if (document.querySelector('.blog-content')) { // Only run blog outline on blog pages
            if (typeof generateBlogOutline === 'function') {
                generateBlogOutline();
            } else {
                console.warn("'generateBlogOutline' function is not defined.");
            }
        }
        
        if (typeof setupEmptyLinkPopups === 'function') {
            setupEmptyLinkPopups();
        } else {
            console.warn("'setupEmptyLinkPopups' function is not defined.");
        }

        if (typeof updateLinksScrollableState === 'function') {
             updateLinksScrollableState();
        } else {
            console.warn("'updateLinksScrollableState' function is not defined.");
        }
        
        // Load music player modules. This function should internally handle playerIntegration.init()
        if (typeof loadMusicPlayerModules === 'function') {
            await loadMusicPlayerModules();
            
            // Give the music player a moment to initialize, then ensure tracklist is populated
            await new Promise(resolve => setTimeout(resolve, 500));
            if (window.persistentPlayer && typeof window.persistentPlayer.renderTracklist === 'function') {
                window.persistentPlayer.renderTracklist('#tracklist-column');
            } else {
                console.error('🎵 Music player not properly initialized!', {
                    persistentPlayer: !!window.persistentPlayer,
                    renderTracklist: window.persistentPlayer?.renderTracklist
                });
            }
        } else {
            console.warn("'loadMusicPlayerModules' function is not defined.");
        }

        // Initialize mobile tracklist after all partials are loaded
        if (typeof initializeMobileTracklist === 'function') {
            initializeMobileTracklist();
        } else {
            console.warn("'initializeMobileTracklist' function is not defined.");
        }

        // Initialize mobile menu after all partials are loaded
        if (typeof initializeNewMobileMenu === 'function') {
            initializeNewMobileMenu();
        } else {
            console.warn("'initializeNewMobileMenu' function is not defined.");
        }

        debugLog('All initial partials and scripts should be loaded and initialized.');
        
        // Setup debug button functionality
        
        // Final comprehensive test after everything is loaded
        setTimeout(() => {
            debugLog('🔍 Final system check:', {
                persistentPlayer: !!window.persistentPlayer,
                tracks: window.persistentPlayer?.tracks?.length || 0,
                tracklistContainer: !!document.getElementById('tracklist-column'),
                trackItemsContainer: !!document.getElementById('track-items-container'),
                renderedTracks: document.querySelectorAll('.track-item-card').length,
                clockContainer: !!document.getElementById('clock-widget-placeholder'),
                clockPanel: !!document.getElementById('clock-widget-panel')
            });
            
            // If no tracks are rendered, try one more time
            const renderedTracks = document.querySelectorAll('.track-item-card');
            if (renderedTracks.length === 0 && window.persistentPlayer?.tracks?.length > 0) {
                debugLog('🔄 No tracks found, attempting final render...');
                window.persistentPlayer.renderTracklist('#tracklist-column');
            }
        }, 2000);

        const onboardingTooltip = document.getElementById('onboarding-tooltip');
        const onboardingOkayBtn = document.getElementById('onboarding-okay-btn');
        const toggleForTooltip = document.getElementById('headerDarkToggle') || document.querySelector('.dark-mode-toggle');
        const hasSeenTooltip = localStorage.getItem('hasSeenDarkModeTooltip') === 'true';

        // This check ensures the tooltip logic only runs if the tooltip exists on the page
        if (onboardingTooltip && onboardingOkayBtn && toggleForTooltip) {
            if (!hasSeenTooltip) {
                // Position the tooltip relative to the toggle switch
                const rect = toggleForTooltip.getBoundingClientRect();
                onboardingTooltip.style.top = `${rect.bottom + 10}px`;
                onboardingTooltip.style.left = `${rect.left + (rect.width / 2)}px`; // Center it
                onboardingTooltip.style.transform = 'translateX(-50%)'; // Adjust for centering
                
                // Show backdrop and tooltip
                const backdrop = document.getElementById('onboarding-backdrop');
                if(backdrop) {
                    backdrop.style.display = 'block';
                    setTimeout(() => backdrop.classList.add('show'), 10);
                }
                onboardingTooltip.style.display = 'block';
                setTimeout(() => onboardingTooltip.classList.add('show'), 10);
            }

            onboardingOkayBtn.addEventListener('click', () => {
                const backdrop = document.getElementById('onboarding-backdrop');
                if(backdrop) {
                    backdrop.classList.remove('show');
                    setTimeout(() => backdrop.style.display = 'none', 300);
                }
                onboardingTooltip.classList.remove('show');
                setTimeout(() => onboardingTooltip.style.display = 'none', 300);
                localStorage.setItem('hasSeenDarkModeTooltip', 'true');
            });
        }

        // Apply saved dark mode state on load (default to dark mode if no preference)
        const darkModeSetting = localStorage.getItem('darkMode');
        const savedDarkMode = darkModeSetting === null ? true : darkModeSetting === 'true';
        applyDarkMode(savedDarkMode);

    } catch (error) {
        console.error('Error during DOMContentLoaded initialization sequence:', error);
    }
});

// Ensure that functions like initNewDynamicTextAnimation, setupEmptyLinkPopups, 
// generateBlogOutline, initVinylCoverflow, applyDarkMode, initializeNewMobileMenu,
// loadMusicPlayerModules, updateLinksScrollableState
// are defined ABOVE this DOMContentLoaded listener or correctly imported as modules if applicable.
// Also ensure BASE_PATH is defined at the top of the script.

// REMOVE standalone DOMContentLoaded listeners like:
// document.addEventListener('DOMContentLoaded', initNewDynamicTextAnimation);
// document.addEventListener('DOMContentLoaded', setupEmptyLinkPopups);
// document.addEventListener('DOMContentLoaded', generateBlogOutline); 
// etc., if they were previously separate.

// ========== ENHANCED BENTO ANCHORING SYSTEM ==========
function initBentoAnchoring() {
    debugLog('🔗 Initializing enhanced bento anchoring system...');
    
    const tracklistPanel = document.querySelector('.tracklist-panel');
    const clockWidget = document.querySelector('.clock-widget-panel');
    const bentoElements = [tracklistPanel, clockWidget].filter(Boolean);
    
    if (bentoElements.length === 0) {
        console.warn('⚠️ No bento elements found for anchoring');
        return;
    }
    
    // Enhanced scroll-based anchoring behavior
    let scrollTimeout;
    let lastScrollY = window.scrollY;
    
    function handleScroll() {
        const currentScrollY = window.scrollY;
        const scrollDelta = currentScrollY - lastScrollY;
        
        // Clear previous timeout
        clearTimeout(scrollTimeout);
        
        // Add scroll-active class for enhanced visual feedback
        bentoElements.forEach(element => {
            element.classList.add('scroll-active');
        });
        
        // Simplified anchoring - removed problematic visual effects
        // Just add/remove scroll-active class for basic state tracking
        
        // Reset effects after scroll ends
        scrollTimeout = setTimeout(() => {
            bentoElements.forEach(element => {
                element.classList.remove('scroll-active');
            });
        }, 150);
        
        lastScrollY = currentScrollY;
    }
    
    // Intersection Observer for enhanced anchoring awareness
    const observerOptions = {
        root: null,
        rootMargin: '-20% 0px -20% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1]
    };
    
    const anchorObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const element = entry.target;
            const intersectionRatio = entry.intersectionRatio;
            
            // Simplified intersection tracking - removed opacity changes
            if (intersectionRatio > 0.5) {
                element.classList.add('fully-anchored');
                element.classList.remove('partially-anchored');
            } else if (intersectionRatio > 0.25) {
                element.classList.add('partially-anchored');
                element.classList.remove('fully-anchored');
            } else {
                element.classList.remove('fully-anchored', 'partially-anchored');
            }
        });
    }, observerOptions);
    
    // Observe all bento elements
    bentoElements.forEach(element => {
        anchorObserver.observe(element);
    });
    
    // Add scroll listener with throttling
    let ticking = false;
    function requestScrollUpdate() {
        if (!ticking) {
            requestAnimationFrame(() => {
                handleScroll();
                ticking = false;
            });
            ticking = true;
        }
    }
    
    window.addEventListener('scroll', requestScrollUpdate, { passive: true });
    
    // Enhanced interaction feedback
    bentoElements.forEach(element => {
        // Mouse enter/leave for better anchoring feedback
        element.addEventListener('mouseenter', () => {
            element.classList.add('anchor-hover');
        });
        
        element.addEventListener('mouseleave', () => {
            element.classList.remove('anchor-hover');
        });
        
        // Focus tracking for accessibility
        element.addEventListener('focusin', () => {
            element.classList.add('anchor-focused');
        });
        
        element.addEventListener('focusout', () => {
            element.classList.remove('anchor-focused');
        });
    });
    
    debugLog('✅ Enhanced bento anchoring system initialized successfully');
    debugLog(`📦 Monitoring ${bentoElements.length} bento elements`);
}
