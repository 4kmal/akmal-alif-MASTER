// Standalone version of music player for debugging
console.log('🎵 Loading standalone music player...');

// Simple test class
class SimpleMusicPlayer {
    constructor() {
        console.log('🎵 SimpleMusicPlayer constructor called');
        this.tracks = [
            { id: 'track1', name: "friends", audio: "./lagu/friends.mp3", cd: "./assets/cd/cd2.webp" },
            { id: 'track2', name: "ok", audio: "./lagu/ok.mp3", cd: "./assets/cd/cd1.webp" },
            { id: 'track3', name: "i know", audio: "./lagu/i know.mp3", cd: "./assets/cd/cd1.webp" }
        ];
        console.log('🎵 SimpleMusicPlayer tracks:', this.tracks.length);
    }
    
    renderTracklist(selector) {
        console.log('🎵 SimpleMusicPlayer renderTracklist called with:', selector);
        const container = document.querySelector(selector);
        if (!container) {
            console.error('🎵 Container not found:', selector);
            return;
        }
        
        const trackItemsContainer = container.querySelector('#track-items-container') || container;
        
        trackItemsContainer.innerHTML = this.tracks.map(track => 
            `<div class="track-item-card" data-track-id="${track.id}">
                <span class="track-item-name">${track.name}</span>
                <span class="track-item-drag-handle">☰</span>
            </div>`
        ).join('');
        
        console.log('🎵 SimpleMusicPlayer rendered', this.tracks.length, 'tracks');
        
        // Add click listeners
        trackItemsContainer.querySelectorAll('.track-item-card').forEach(trackEl => {
            trackEl.addEventListener('click', () => {
                console.log('🎵 Track clicked:', trackEl.dataset.trackId);
            });
        });
    }
    
    loadTrack(trackId, autoPlay) {
        console.log('🎵 SimpleMusicPlayer loadTrack:', trackId, autoPlay);
    }
}

// Create and assign to window immediately
window.simpleMusicPlayer = new SimpleMusicPlayer();
console.log('🎵 SimpleMusicPlayer assigned to window.simpleMusicPlayer');