// analytics.js - Vercel Analytics implementation for this static Vite site.

import { inject, track } from '@vercel/analytics';

class VercelAnalytics {
    constructor() {
        this.initialized = false;
        this.debug = false; // Set to true for development
    }

    // Initialize analytics
    init() {
        if (this.initialized) return;

        inject();
        this.initialized = true;
        
        if (this.debug) {
            console.log('Vercel Analytics initialized');
        }
    }

    // Track page views
    trackPageView() {
        // Get current page info
        const pageData = {
            url: window.location.href,
            title: document.title,
            referrer: document.referrer || '',
            timestamp: new Date().toISOString()
        };

        // Send page view event
        this.track('pageview', pageData);
        
        if (this.debug) {
            console.log('Page view tracked:', pageData);
        }
    }

    // Track custom events
    track(eventName, eventData = {}) {
        track(eventName, eventData);
        
        if (this.debug) {
            console.log(`Event tracked: ${eventName}`, eventData);
        }
    }

    // Track music player events
    trackMusicEvent(action, trackName = '') {
        this.track('music_player', {
            action: action,
            track: trackName,
            timestamp: new Date().toISOString()
        });
    }

    // Track navigation events
    trackNavigation(destination) {
        this.track('navigation', {
            destination: destination,
            from: window.location.pathname,
            timestamp: new Date().toISOString()
        });
    }

    // Track contact form events
    trackContactForm(action) {
        this.track('contact_form', {
            action: action,
            timestamp: new Date().toISOString()
        });
    }
}

// Create global analytics instance
window.analytics = new VercelAnalytics();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.analytics.init();
    });
} else {
    window.analytics.init();
}

// Track navigation for single-page-app-like behavior
window.addEventListener('popstate', () => {
    window.analytics.trackPageView();
});
