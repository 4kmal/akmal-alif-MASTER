// speed-insights.js - Vercel Speed Insights Implementation for Vanilla JavaScript

class VercelSpeedInsights {
    constructor() {
        this.initialized = false;
        this.debug = false; // Set to true for development
        this.sampleRate = 1.0; // Send all events by default
        this.vitalsUrl = 'https://vitals.vercel-insights.com/v1/vitals';
        this.metrics = new Map();
        this.sessionId = this.generateSessionId();
    }

    // Generate a unique session ID
    generateSessionId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    // Initialize speed insights
    init() {
        if (this.initialized) return;

        // Only initialize on Vercel-deployed sites or localhost for testing
        if (!this.isValidEnvironment()) {
            if (this.debug) {
                console.log('🚀 Speed Insights: Not on Vercel deployment, skipping initialization');
            }
            return;
        }

        this.setupVitalsCollection();
        this.initialized = true;

        if (this.debug) {
            console.log('🔍 Vercel Speed Insights initialized');
        }
    }

    // Check if we're in a valid environment for Speed Insights
    isValidEnvironment() {
        const hostname = window.location.hostname;
        return (
            hostname.includes('vercel.app') ||
            hostname.includes('.vercel.app') ||
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            this.debug
        );
    }

    // Setup Core Web Vitals collection
    setupVitalsCollection() {
        // Use Web Vitals library if available, otherwise implement basic collection
        if (typeof window.webVitals !== 'undefined') {
            this.setupWebVitalsLibrary();
        } else {
            this.setupBasicVitalsCollection();
        }
    }

    // Setup using Web Vitals library (if loaded)
    setupWebVitalsLibrary() {
        const vitals = ['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB'];
        
        vitals.forEach(vital => {
            if (typeof window.webVitals[vital] === 'function') {
                window.webVitals[vital]((metric) => {
                    this.sendVital(metric);
                });
            }
        });
    }

    // Basic vitals collection using browser APIs
    setupBasicVitalsCollection() {
        // Collect FCP (First Contentful Paint)
        this.collectFCP();
        
        // Collect LCP (Largest Contentful Paint)
        this.collectLCP();
        
        // Collect CLS (Cumulative Layout Shift)
        this.collectCLS();
        
        // Collect FID/INP (First Input Delay/Interaction to Next Paint)
        this.collectFID();
        
        // Collect TTFB (Time to First Byte)
        this.collectTTFB();
    }

    // Collect First Contentful Paint
    collectFCP() {
        const paintObserver = new PerformanceObserver((entryList) => {
            const entries = entryList.getEntries();
            const fcpEntry = entries.find(entry => entry.name === 'first-contentful-paint');
            
            if (fcpEntry) {
                this.sendVital({
                    name: 'FCP',
                    value: fcpEntry.startTime,
                    rating: this.getRating('FCP', fcpEntry.startTime)
                });
                paintObserver.disconnect();
            }
        });

        try {
            paintObserver.observe({ entryTypes: ['paint'] });
        } catch (error) {
            if (this.debug) console.warn('FCP collection not supported');
        }
    }

    // Collect Largest Contentful Paint
    collectLCP() {
        let largestPaint = 0;
        
        const lcpObserver = new PerformanceObserver((entryList) => {
            const entries = entryList.getEntries();
            const lastEntry = entries[entries.length - 1];
            
            if (lastEntry.startTime > largestPaint) {
                largestPaint = lastEntry.startTime;
                
                this.sendVital({
                    name: 'LCP',
                    value: largestPaint,
                    rating: this.getRating('LCP', largestPaint)
                });
            }
        });

        try {
            lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
        } catch (error) {
            if (this.debug) console.warn('LCP collection not supported');
        }
    }

    // Collect Cumulative Layout Shift
    collectCLS() {
        let clsValue = 0;
        
        const clsObserver = new PerformanceObserver((entryList) => {
            const entries = entryList.getEntries();
            
            for (const entry of entries) {
                if (!entry.hadRecentInput) {
                    clsValue += entry.value;
                }
            }
            
            this.sendVital({
                name: 'CLS',
                value: clsValue,
                rating: this.getRating('CLS', clsValue)
            });
        });

        try {
            clsObserver.observe({ entryTypes: ['layout-shift'] });
        } catch (error) {
            if (this.debug) console.warn('CLS collection not supported');
        }
    }

    // Collect First Input Delay
    collectFID() {
        const fidObserver = new PerformanceObserver((entryList) => {
            const firstInput = entryList.getEntries()[0];
            
            if (firstInput) {
                const fid = firstInput.processingStart - firstInput.startTime;
                
                this.sendVital({
                    name: 'FID',
                    value: fid,
                    rating: this.getRating('FID', fid)
                });
                fidObserver.disconnect();
            }
        });

        try {
            fidObserver.observe({ entryTypes: ['first-input'] });
        } catch (error) {
            if (this.debug) console.warn('FID collection not supported');
        }
    }

    // Collect Time to First Byte
    collectTTFB() {
        if ('navigation' in performance && 'getEntriesByType' in performance) {
            const navEntries = performance.getEntriesByType('navigation');
            if (navEntries.length > 0) {
                const ttfb = navEntries[0].responseStart;
                
                this.sendVital({
                    name: 'TTFB',
                    value: ttfb,
                    rating: this.getRating('TTFB', ttfb)
                });
            }
        }
    }

    // Get performance rating based on Core Web Vitals thresholds
    getRating(name, value) {
        const thresholds = {
            FCP: { good: 1800, poor: 3000 },
            LCP: { good: 2500, poor: 4000 },
            CLS: { good: 0.1, poor: 0.25 },
            FID: { good: 100, poor: 300 },
            INP: { good: 200, poor: 500 },
            TTFB: { good: 800, poor: 1800 }
        };

        if (!thresholds[name]) return 'unknown';

        if (value <= thresholds[name].good) return 'good';
        if (value <= thresholds[name].poor) return 'needs-improvement';
        return 'poor';
    }

    // Send vital metric to Vercel
    async sendVital(metric) {
        if (Math.random() > this.sampleRate) {
            return; // Skip based on sample rate
        }

        const vitalsData = {
            dsn: window.location.hostname,
            id: metric.id || this.generateMetricId(),
            name: metric.name,
            value: Math.round(metric.value),
            rating: metric.rating,
            href: window.location.href,
            sessionId: this.sessionId,
            timestamp: Date.now()
        };

        try {
            if (this.debug) {
                console.log(`📊 Speed Insights - ${metric.name}:`, vitalsData);
            }

            // Use beacon API for reliability, fallback to fetch
            if ('sendBeacon' in navigator) {
                navigator.sendBeacon(
                    this.vitalsUrl,
                    JSON.stringify(vitalsData)
                );
            } else {
                await fetch(this.vitalsUrl, {
                    method: 'POST',
                    body: JSON.stringify(vitalsData),
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    keepalive: true
                });
            }
        } catch (error) {
            if (this.debug) {
                console.error('Failed to send vital:', error);
            }
        }
    }

    // Generate unique metric ID
    generateMetricId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    // Manual performance tracking for custom events
    trackCustomMetric(name, value, rating = 'unknown') {
        this.sendVital({
            name: `custom-${name}`,
            value: value,
            rating: rating
        });
    }
}

// Create global speed insights instance
window.speedInsights = new VercelSpeedInsights();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.speedInsights.init();
    });
} else {
    window.speedInsights.init();
}

// Load Web Vitals library for better accuracy (optional)
(function loadWebVitalsLibrary() {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/web-vitals@3/dist/web-vitals.iife.js';
    script.async = true;
    script.onload = () => {
        if (window.speedInsights && !window.speedInsights.initialized) {
            window.speedInsights.init();
        }
    };
    document.head.appendChild(script);
})();