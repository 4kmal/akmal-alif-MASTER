// navigation-analytics.js - Track navigation events across the site

function setupNavigationAnalytics() {
    console.log('📊 Setting up navigation analytics...');
    
    // Track all navigation links in the header
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (!link || !window.analytics) return;
        
        const href = link.getAttribute('href');
        let destination = 'unknown';
        
        // Determine destination based on href
        if (href.includes('blog')) {
            destination = 'blog';
        } else if (href.includes('contact')) {
            destination = 'contact';
        } else if (href.includes('playground')) {
            destination = 'playground';
        } else if (href.includes('index.html') || href === './') {
            destination = 'home';
        } else if (href.startsWith('#')) {
            destination = 'anchor_' + href.substring(1);
        } else if (href.startsWith('http')) {
            destination = 'external_' + new URL(href).hostname;
        }
        
        // Track the navigation
        if (destination !== 'unknown') {
            window.analytics.trackNavigation(destination);
        }
    });
    
    // Track dropdown menu interactions
    const dropdownTriggers = document.querySelectorAll('.dropdown-trigger');
    dropdownTriggers.forEach(trigger => {
        trigger.addEventListener('click', () => {
            if (window.analytics) {
                window.analytics.track('dropdown_menu', {
                    action: 'toggle',
                    menu: trigger.textContent.trim()
                });
            }
        });
    });
    
    // Track dark mode toggle
    const darkToggle = document.getElementById('headerDarkToggle');
    if (darkToggle) {
        darkToggle.addEventListener('click', () => {
            if (window.analytics) {
                const isDark = document.body.classList.contains('dark');
                window.analytics.track('dark_mode', {
                    action: 'toggle',
                    mode: isDark ? 'light' : 'dark'
                });
            }
        });
    }
    
    // Track mobile menu interactions
    const mobileMenuButton = document.querySelector('.mobile-menu-button');
    if (mobileMenuButton) {
        mobileMenuButton.addEventListener('click', () => {
            if (window.analytics) {
                window.analytics.track('mobile_menu', {
                    action: 'toggle'
                });
            }
        });
    }
    
    // Track mobile tracklist button
    const mobileTracklistButton = document.querySelector('.mobile-tracklist-button');
    if (mobileTracklistButton) {
        mobileTracklistButton.addEventListener('click', () => {
            if (window.analytics) {
                window.analytics.track('mobile_tracklist', {
                    action: 'toggle'
                });
            }
        });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupNavigationAnalytics);
} else {
    setupNavigationAnalytics();
}

// Also set up after partials are loaded (in case header is loaded dynamically)
document.addEventListener('partialLoaded', (e) => {
    if (e.detail && e.detail.placeholderId === 'site-header-placeholder') {
        setupNavigationAnalytics();
    }
});