// speed-insights.js - Vercel Speed Insights for this static Vite site.

import { injectSpeedInsights } from '@vercel/speed-insights';

class VercelSpeedInsights {
    constructor() {
        this.initialized = false;
        this.debug = false;
        this.controller = null;
    }

    init() {
        if (this.initialized) return;

        this.controller = injectSpeedInsights({
            framework: 'vite',
            debug: this.debug,
        });
        this.initialized = true;

        if (this.debug) {
            console.log('Vercel Speed Insights initialized');
        }
    }

    setRoute(route) {
        if (this.controller && typeof this.controller.setRoute === 'function') {
            this.controller.setRoute(route);
        }
    }

    // Compatibility shim for existing project code. Official Speed Insights
    // collects Web Vitals automatically and does not accept custom metrics.
    trackCustomMetric(name, value, rating = 'unknown') {
        if (this.debug) {
            console.log('Speed Insights custom metric ignored:', { name, value, rating });
        }
    }
}

window.speedInsights = new VercelSpeedInsights();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.speedInsights.init();
    });
} else {
    window.speedInsights.init();
}

window.addEventListener('popstate', () => {
    window.speedInsights.setRoute(window.location.pathname);
});
