// vercel-monitoring.js - Unified Vercel Analytics & Speed Insights Integration

class VercelMonitoring {
    constructor() {
        this.initialized = false;
        this.debug = false;
    }

    init() {
        if (this.initialized) return;

        console.log('📊 Vercel Monitoring initialized - Analytics & Speed Insights ready');
        
        // Setup page load performance tracking
        this.trackPageLoadPerformance();
        
        // Setup navigation performance tracking
        this.setupNavigationPerformanceTracking();
        
        // Setup resource loading tracking
        this.trackResourcePerformance();
        
        this.initialized = true;
    }

    // Track overall page load performance
    trackPageLoadPerformance() {
        window.addEventListener('load', () => {
            setTimeout(() => {
                if (window.speedInsights) {
                    const loadTime = performance.now();
                    window.speedInsights.trackCustomMetric('page_load_time', loadTime,
                        loadTime < 2000 ? 'good' : loadTime < 4000 ? 'needs-improvement' : 'poor');
                }
                
                if (window.analytics) {
                    window.analytics.track('page_load_complete', {
                        page: window.location.pathname,
                        loadTime: Math.round(performance.now()),
                        timestamp: new Date().toISOString()
                    });
                }
            }, 100);
        });
    }

    // Track navigation performance for SPA-like behavior
    setupNavigationPerformanceTracking() {
        let navigationStart = performance.now();
        
        // Track link clicks and measure navigation time
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[href]');
            if (link && !link.href.startsWith('javascript:') && !link.href.includes('#')) {
                navigationStart = performance.now();
                
                if (window.analytics) {
                    window.analytics.track('navigation_start', {
                        from: window.location.pathname,
                        to: link.href,
                        timestamp: new Date().toISOString()
                    });
                }
            }
        });

        // Measure time between navigation events
        window.addEventListener('beforeunload', () => {
            if (window.speedInsights) {
                const navigationTime = performance.now() - navigationStart;
                if (navigationTime > 100) { // Only track if meaningful
                    window.speedInsights.trackCustomMetric('navigation_time', navigationTime,
                        navigationTime < 500 ? 'good' : navigationTime < 1000 ? 'needs-improvement' : 'poor');
                }
            }
        });
    }

    // Track resource loading performance
    trackResourcePerformance() {
        window.addEventListener('load', () => {
            setTimeout(() => {
                const resourceEntries = performance.getEntriesByType('resource');
                
                // Track slow loading resources
                resourceEntries.forEach(resource => {
                    if (resource.duration > 1000) { // Resources taking over 1s
                        if (window.speedInsights) {
                            window.speedInsights.trackCustomMetric(
                                `slow_resource_${this.getResourceType(resource.name)}`,
                                resource.duration,
                                'poor'
                            );
                        }
                        
                        if (window.analytics && this.debug) {
                            window.analytics.track('slow_resource', {
                                name: resource.name,
                                type: this.getResourceType(resource.name),
                                duration: Math.round(resource.duration),
                                size: resource.transferSize
                            });
                        }
                    }
                });

                // Track total resources size
                const totalSize = resourceEntries.reduce((total, resource) => 
                    total + (resource.transferSize || 0), 0);
                
                if (window.speedInsights && totalSize > 0) {
                    window.speedInsights.trackCustomMetric('total_resource_size', totalSize / 1024, // KB
                        totalSize < 500000 ? 'good' : totalSize < 1000000 ? 'needs-improvement' : 'poor');
                }
            }, 2000);
        });
    }

    // Determine resource type from URL
    getResourceType(url) {
        if (url.match(/\.(js)$/)) return 'script';
        if (url.match(/\.(css)$/)) return 'stylesheet';
        if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) return 'image';
        if (url.match(/\.(mp3|wav|ogg)$/)) return 'audio';
        if (url.match(/\.(mp4|webm|mov)$/)) return 'video';
        if (url.match(/\.(woff|woff2|ttf|otf)$/)) return 'font';
        return 'other';
    }

    // Track music player specific performance
    trackMusicPlayerPerformance() {
        // Track waveform generation time
        const originalGenerateWaveform = window.musicPlayer?.generateWaveformData;
        if (originalGenerateWaveform) {
            window.musicPlayer.generateWaveformData = function(audioBuffer, samples) {
                const start = performance.now();
                const result = originalGenerateWaveform.call(this, audioBuffer, samples);
                const duration = performance.now() - start;
                
                if (window.speedInsights) {
                    window.speedInsights.trackCustomMetric('waveform_generation', duration,
                        duration < 50 ? 'good' : duration < 100 ? 'needs-improvement' : 'poor');
                }
                
                return result;
            };
        }
    }

    // Track custom user interactions
    trackInteractionPerformance(actionName, startTime) {
        const duration = performance.now() - startTime;
        
        if (window.speedInsights) {
            window.speedInsights.trackCustomMetric(`interaction_${actionName}`, duration,
                duration < 100 ? 'good' : duration < 300 ? 'needs-improvement' : 'poor');
        }
        
        if (window.analytics) {
            window.analytics.track('interaction_performance', {
                action: actionName,
                duration: Math.round(duration),
                timestamp: new Date().toISOString()
            });
        }
    }

    // Enable debug mode
    enableDebug() {
        this.debug = true;
        if (window.analytics) window.analytics.debug = true;
        if (window.speedInsights) window.speedInsights.debug = true;
        console.log('🔍 Vercel Monitoring debug mode enabled');
    }
}

// Create global monitoring instance
window.vercelMonitoring = new VercelMonitoring();

// Initialize when everything is ready
window.addEventListener('load', () => {
    setTimeout(() => {
        window.vercelMonitoring.init();
        window.vercelMonitoring.trackMusicPlayerPerformance();
    }, 500);
});