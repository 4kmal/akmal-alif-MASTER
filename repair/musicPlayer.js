// js/modules/musicPlayer.js - Persistent Music Player Module

class PersistentMusicPlayer {
    constructor() {
        this.isInitialized = false;
        this.audioContext = null;
        this.analyser = null;
        this.audioBuffers = new Map();
        this.waveformData = new Map();
        this.currentTrack = null;
        this.isPlaying = false;
        this.currentTime = 0;
        this.duration = 0;
        this.isMinimized = false;
        this.crossfadeTime = 1;
        this._mainWaveformFrame = null; // For managing animation loop
        this.waveformBarColorPlayed = '#6A0DAD'; // Played bar color (can be themed)
        this.waveformBarColorUnplayed = '#d1b3ff'; // Unplayed bar color (can be themed)
        this.waveformBarColorPreview = '#b388ff'; // Preview hover color (can be themed)
        
                this.tracks = [
    { id: 'track1', name: "friends", audio: "./lagu/friends.mp3", cd: "./green screen/cd2.webp" },
    { id: 'track2', name: "ok", audio: "./lagu/ok.mp3", cd: "./green screen/cd1.webp" },
    { id: 'track3', name: "i know", audio: "./lagu/i know.mp3", cd: "./green screen/cd1.webp" },
    { id: 'track4', name: "what i want", audio: "./lagu/what i want.mp3", cd: "./green screen/cd1.webp" },
    { id: 'track5', name: "terus terang", audio: "./lagu/terus terang.mp3", cd: "./green screen/cd2.webp" },
    { id: 'track6', name: "Hello World!", audio: "./lagu/interlude.mp3", cd: "./green screen/cd1.webp" },
    { id: 'track7', name: "Bone music", audio: "./lagu/test1.mp3", cd: "./green screen/cd3.webp" },
    { id: 'track8', name: "ADHD music", audio: "./lagu/adhd.mp3", cd: "./green screen/cdjackass.webp" },
    { id: 'track9', name: "Fifa 2030", audio: "./lagu/fifa.mp3", cd: "./green screen/cdfifa.webp" },
    { id: 'track10', name: "🟡", audio: "./lagu/test2.mp3", cd: "./green screen/cd4.webp" }
        ];
        
        this.audio = new Audio();
        this.secondaryAudio = new Audio();
        this.secondaryAudio.preload = 'metadata';

        this.activeAudioElement = this.audio;
        this.isCrossfading = false;

        this.setupAudioEvents(this.audio);
        this.secondaryAudio.addEventListener('error', (e) => {
            console.warn('Secondary audio preload error:', e);
        });

        this.restoreState();
        this.createFloatingPlayer();
        this.updateFloatingPlayer();
    }

    async init() {
        if (this.isInitialized) return;
        
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 1024; // Adjusted for a reasonable number of bars for frequency data
            this.analyser.smoothingTimeConstant = 0.8; // Optional: smooths out changes
            
            this.mediaElementSource = this.audioContext.createMediaElementSource(this.audio);
            this.mediaElementSource.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);
            
            this.isInitialized = true;
            console.log('Audio context initialized. Waveforms will be loaded on demand.');
            
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
        }
    }

    async loadWaveformForTrack(trackId) {
        if (!this.audioContext) {
            console.warn("AudioContext not ready, cannot load waveform.");
            return;
        }
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        try {
            const response = await fetch(track.audio);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
            
            this.audioBuffers.set(track.id, audioBuffer);
            this.waveformData.set(track.id, this.generateWaveformData(audioBuffer));
            console.log(`Waveform loaded for ${track.name}`);
            this.updateMainWaveform(); // Redraw waveform now that data is available
        } catch (error) {
            console.error(`Failed to load waveform for ${track.name}:`, error);
        }
    }

    generateWaveformData(audioBuffer, samples = 500) {
        const channelData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(channelData.length / samples);
        const waveform = [];
        
        for (let i = 0; i < samples; i++) {
            let sum = 0;
            for (let j = 0; j < blockSize; j++) {
                sum += Math.abs(channelData[i * blockSize + j]);
            }
            waveform.push(sum / blockSize);
        }
        
        // Normalize
        const max = Math.max(...waveform);
        return waveform.map(val => val / max);
    }

    setupAudioEvents(audioElement) {
        audioElement.addEventListener('timeupdate', () => {
            if (audioElement === this.activeAudioElement) {
                this.currentTime = audioElement.currentTime;
                this.saveState();
                this.updateUI();
            }
        });

        audioElement.addEventListener('loadedmetadata', () => {
            if (audioElement === this.activeAudioElement) {
                this.duration = audioElement.duration;
                this.updateUI();
            }
        });

        audioElement.addEventListener('play', () => {
            if (audioElement === this.activeAudioElement) {
                this.isPlaying = true;
                this.saveState();
                this.updateUI();
            }
        });

        audioElement.addEventListener('pause', () => {
            if (audioElement === this.activeAudioElement && !this.isCrossfading) {
                this.isPlaying = false;
                this.saveState();
                this.updateUI();
            }
        });

        audioElement.addEventListener('ended', () => {
            if (audioElement === this.activeAudioElement) {
                this.playNext();
            }
        });

        audioElement.addEventListener('error', (e) => {
            if (audioElement === this.activeAudioElement) {
                console.error('Error with primary audio element:', e);
            }
        });
    }

    saveState() {
        const state = {
            currentTrack: this.currentTrack,
            currentTime: this.currentTime,
            isPlaying: this.isPlaying,
            isMinimized: this.isMinimized,
            volume: this.audio.volume,
            trackOrder: this.tracks.map(t => t.id)
        };
        localStorage.setItem('musicPlayerState', JSON.stringify(state));
    }

    restoreState() {
        const saved = localStorage.getItem('musicPlayerState');
        if (saved) {
            const state = JSON.parse(saved);

            // Restore track order first if available
            if (state.trackOrder && Array.isArray(state.trackOrder)) {
                const newTracks = [];
                const currentTrackIds = this.tracks.map(t => t.id);
                state.trackOrder.forEach(savedId => {
                    const track = this.tracks.find(t => t.id === savedId);
                    if (track) {
                        newTracks.push(track);
                    }
                });
                // Add any tracks that are new since last save (not in savedOrder but in current hardcoded list)
                this.tracks.forEach(hardcodedTrack => {
                    if (!newTracks.find(nt => nt.id === hardcodedTrack.id)) {
                        newTracks.push(hardcodedTrack); 
                    }
                });
                this.tracks = newTracks;
            }

            this.currentTrack = state.currentTrack;
            if (this.currentTrack) {
                // Call loadTrack with autoPlay set to false initially.
                // The isPlaying state will be handled separately.
                this.loadTrack(this.currentTrack, false); 
                this.audio.currentTime = state.currentTime || 0;
                this.currentTime = state.currentTime || 0; // Ensure this.currentTime is also updated

                let vol = parseFloat(state.volume);
                this.audio.volume = (!isNaN(vol) && vol >= 0 && vol <= 1) ? vol : 0.5;

                // Restore playing state AFTER track is loaded and time is set
                if (state.isPlaying && this.currentTrack) {
                    // We need to ensure the audio can play, especially if init() hasn't fully run or user hasn't interacted
                    // The play() method handles AudioContext resume
                    this.play().catch(e => {
                        console.warn("Could not automatically resume playback on restore:", e);
                        this.isPlaying = false; // Correct the state if autoplay fails
                        this.updateUI();
                    });
                } else {
                    this.isPlaying = false; // Ensure it's paused if not meant to be playing
                    this.updateUI(); // Update UI to reflect paused state
                }

            } else {
                this.audio.volume = 0.5;
                this.isPlaying = false; // Default to not playing if no track
            }
            // this.isMinimized = state.isMinimized || false; // Restore minimized state - handled by updateFloatingPlayer logic
            this.isMinimized = false; // Default to not minimized on page load, will be set by actual player state

        } else {
            this.isMinimized = false;
            this.audio.volume = 0.5;
            this.isPlaying = false;
        }
        // Initial UI update after restoring state, before init might complete fully
        this.updateUI(); 
    }

    async loadTrack(trackId, autoPlay = true) {
        if (this.isInitialized && !this.waveformData.has(trackId)) {
            this.loadWaveformForTrack(trackId);
        }

        const track = this.tracks.find(t => t.id === trackId);
        if (!track) {
            console.error('Track not found:', trackId);
            return;
        }

        if (this.audio.src.endsWith(track.audio) && !autoPlay && this.currentTime > 0) {
            console.log(`Track ${track.name} already loaded. Updating UI.`);
            this.currentTrack = trackId;
            if (this.isPlaying) {
                this.play().catch(e => console.error("Error re-initiating play on loadTrack:", e));
            } else {
                this.pause();
            }
            this.updateUI();
            this.saveState();
            return;
        }

        this.currentTrack = trackId;
        this.audio.src = track.audio;
        this.audio.preload = 'metadata';

        console.log(`Loading track: ${track.name}, autoplay: ${autoPlay}`);
        
        try {
            if (autoPlay) {
                await this.play();
            } else {
                this.audio.load();
            }
        } catch (error) {
            console.error(`Error handling track load for ${track.name}:`, error);
            if (autoPlay) {
                this.isPlaying = false;
                this.updateUI();
            }
        }
        
        this.updateUI();
        this.saveState();
    }

    async play() {
        if (!this.isInitialized) {
            await this.init();
            if (!this.isInitialized) {
                console.error("Cannot play: AudioContext failed to initialize.");
                return;
            }
        }
        
        if (this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
            } catch (resumeError) {
                console.error('AudioContext resume failed:', resumeError);
                alert("Please click or tap on the page to enable audio playback.");
                return;
            }
        }
        
        try {
            await this.audio.play();
            this.isPlaying = true;
        } catch (error) {
            console.error('Error during play attempt:', error);
            this.isPlaying = false;
            this.updateUI();
            this.saveState();
            if (error.name === 'NotAllowedError') {
                alert("Audio playback was not allowed. Please interact with the page (e.g., click a button) and try again.");
            }
        }
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.updateUI();
        this.saveState();
    }

    playNext() {
        if (this.isCrossfading) return;

        const currentIndex = this.tracks.findIndex(t => t.id === this.currentTrack);
        const nextTrackIndex = (currentIndex + 1) % this.tracks.length;
        const nextTrackId = this.tracks[nextTrackIndex].id;
        
        this.loadTrack(nextTrackId, this.isPlaying || true);
    }

    playPrevious() {
        if (this.isCrossfading) return;

        const currentIndex = this.tracks.findIndex(t => t.id === this.currentTrack);
        const prevTrackIndex = (currentIndex - 1 + this.tracks.length) % this.tracks.length;
        const prevTrackId = this.tracks[prevTrackIndex].id;

        this.loadTrack(prevTrackId, this.isPlaying || this.tracks[prevTrackIndex].id !== this.currentTrack);
    }

    seek(percentage) {
        if (this.duration) {
            this.audio.currentTime = (percentage / 100) * this.duration;
        }
    }

    setVolume(volume) {
        this.audio.volume = Math.max(0, Math.min(1, volume));
        this.saveState();
    }

    minimize() {
        this.isMinimized = true;
        this.saveState();
        this.updateFloatingPlayer();
        this.hideMainPlayer();
    }

    maximize() {
        this.isMinimized = false;
        this.saveState();
        this.hideFloatingPlayer();
        this.showMainPlayer();
    }

    createFloatingPlayer() {
        if (document.getElementById('floating-player')) return;

        const floatingPlayer = document.createElement('div');
        floatingPlayer.id = 'floating-player';
        floatingPlayer.className = 'floating-player';
        floatingPlayer.style.display = 'none';
        
        floatingPlayer.innerHTML = `
            <div class="floating-player-content">
                <div class="floating-track-info">
                    <img class="floating-album-art" src="" alt="Album Art">
                    <div class="floating-track-details">
                        <div class="floating-track-name"></div>
                        <div class="floating-waveform-container">
                            <canvas class="floating-waveform" width="200" height="30"></canvas>
                        </div>
                    </div>
                </div>
                <div class="floating-controls">
                    <button class="floating-btn floating-prev">⏮</button>
                    <button class="floating-btn floating-play-pause">⏸</button>
                    <button class="floating-btn floating-next">⏭</button>
                    <button class="floating-btn floating-expand">⬆</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(floatingPlayer);
        this.setupFloatingPlayerEvents();
    }

    setupFloatingPlayerEvents() {
        const floatingPlayer = document.getElementById('floating-player');
        if (!floatingPlayer) return;

        floatingPlayer.querySelector('.floating-play-pause').addEventListener('click', () => {
            this.isPlaying ? this.pause() : this.play();
        });

        floatingPlayer.querySelector('.floating-prev').addEventListener('click', () => {
            this.playPrevious();
        });

        floatingPlayer.querySelector('.floating-next').addEventListener('click', () => {
            this.playNext();
        });

        floatingPlayer.querySelector('.floating-expand').addEventListener('click', () => {
            this.maximize();
        });

        this.makeFloatingPlayerDraggable();
    }

    makeFloatingPlayerDraggable() {
        const floatingPlayer = document.getElementById('floating-player');
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        floatingPlayer.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'CANVAS') return;
            
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;
                
                floatingPlayer.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    updateFloatingPlayer() {
        const floatingPlayer = document.getElementById('floating-player');
        if (!floatingPlayer) return;

        const track = this.tracks.find(t => t.id === this.currentTrack);

        if (this.isMinimized && track) {
            floatingPlayer.style.display = 'flex';
            const floatingAlbumArt = floatingPlayer.querySelector('.floating-album-art');
            const floatingTrackName = floatingPlayer.querySelector('.floating-track-name');
            
            if (floatingAlbumArt) floatingAlbumArt.src = track.cd || 'icon/default-album.webp';
            if (floatingTrackName) floatingTrackName.textContent = track.name;
            
            this.updateFloatingWaveform();
            this.hideMainPlayer();
        } else {
            floatingPlayer.style.display = 'none';
            this.showMainPlayer();
        }
    }

    updateFloatingWaveform() {
        const floatingPlayer = document.getElementById('floating-player');
        if (!floatingPlayer || !this.currentTrack) return;

        const canvas = floatingPlayer.querySelector('.floating-waveform');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const waveform = this.waveformData.get(this.currentTrack);
        if (!waveform) return;

        const width = canvas.width;
        const height = canvas.height;
        const progress = this.duration ? this.currentTime / this.duration : 0;

        const previewX = this._floatingWaveformPreview || null;
        const previewRatio = previewX != null ? previewX / width : null;

        ctx.clearRect(0, 0, width, height);
        const barWidth = width / waveform.length;
        for (let i = 0; i < waveform.length; i++) {
            const barHeight = waveform[i] * height * 0.8;
            const x = i * barWidth;
            const y = (height - barHeight) / 2;
            let color;
            if (previewRatio !== null && i / waveform.length <= previewRatio) {
                color = '#b388ff';
            } else if (i / waveform.length <= progress) {
                color = '#6A0DAD';
            } else {
                color = '#d1b3ff';
            }
            ctx.fillStyle = color;
            ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight);
        }
        if (previewX != null) {
            ctx.save();
            ctx.strokeStyle = '#b388ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(previewX, 0);
            ctx.lineTo(previewX, height);
            ctx.stroke();
            ctx.restore();
        }
    }

    hideFloatingPlayer() {
        const floatingPlayer = document.getElementById('floating-player');
        if (floatingPlayer) {
            floatingPlayer.style.display = 'none';
        }
    }

    hideMainPlayer() {
        const mainPlayer = document.querySelector('.music-player-container');
        if (mainPlayer) {
            mainPlayer.style.display = 'none';
        }
    }

    showMainPlayer() {
        const mainPlayer = document.querySelector('.music-player-container');
        if (mainPlayer) {
            mainPlayer.style.display = 'flex';
        }
    }

    updateUI() {
        this.updateMainPlayer();
        this.updateFloatingPlayer();
        this.updateIpodVisualizer();
        this.ensureWaveformTimelineEvents();
        this.updatePlayingTrackInList();
    }

    updateMainPlayer() {
        const playPauseBtn = document.getElementById('playPauseBtn');
        const trackName = document.querySelector('.track-name');
        const progressBar = document.getElementById('progressBar');
        const waveformCanvas = document.getElementById('waveform-canvas');

        if (playPauseBtn) {
            const playIcon = document.getElementById('playIcon');
            const pauseIcon = document.getElementById('pauseIcon');
            
            if (playIcon && pauseIcon) {
                playIcon.style.display = this.isPlaying ? 'none' : 'block';
                pauseIcon.style.display = this.isPlaying ? 'block' : 'none';
            }
        }

        if (trackName && this.currentTrack) {
            const track = this.tracks.find(t => t.id === this.currentTrack);
            if (track) {
                trackName.textContent = track.name;
            }
        }

        if (progressBar && this.duration) {
            progressBar.value = (this.currentTime / this.duration) * 100;
        }

        this.updateMainWaveform();
        this.updateIpodVisualizer();
        this.ensureWaveformTimelineEvents();
    }

    updateMainWaveform() {
        const canvas = document.getElementById('waveform-canvas');
        if (!canvas || !this.currentTrack) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);

        const waveform = this.waveformData.get(this.currentTrack);
        if (!waveform) { // If no precalculated waveform, nothing to draw
            // Optionally, clear the _mainWaveformFrame if it was somehow set
            if (this._mainWaveformFrame) {
                cancelAnimationFrame(this._mainWaveformFrame);
                this._mainWaveformFrame = null;
            }
            return;
        }

        // Always draw static waveform if data is available
        // Remove the live animation block: if (this.isPlaying && this.isInitialized && this.analyser) { ... }
        if (this._mainWaveformFrame) { // Clean up animation frame if it exists
            cancelAnimationFrame(this._mainWaveformFrame);
            this._mainWaveformFrame = null;
        }

        const progress = this.duration ? this.currentTime / this.duration : 0;
        const barWidth = width / waveform.length;

        for (let i = 0; i < waveform.length; i++) {
            const barHeightValue = waveform[i] * height * 0.9;
            const xPos = i * barWidth;
            // Draw bars from the vertical center, scaled by waveform value
            const yPos = (height - barHeightValue) / 2; 

            if (i / waveform.length <= progress) {
                ctx.fillStyle = this.waveformBarColorPlayed;
            } else {
                ctx.fillStyle = this.waveformBarColorUnplayed;
            }
            ctx.fillRect(xPos, yPos, Math.max(2, barWidth - 1), barHeightValue);
        }

        // Draw preview hover line (common for both playing and static)
        const preview = this._waveformPreview || null;
        if (preview && preview.x != null) {
            ctx.save();
            ctx.strokeStyle = this.waveformBarColorPreview;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(preview.x, 0);
            ctx.lineTo(preview.x, height);
            ctx.stroke();
            ctx.restore();
        }
    }

    updateIpodVisualizer() {
        const canvas = document.getElementById('ipod-visualizer');
        if (!canvas || !this.isInitialized || !this.analyser) { // Added isInitialized check
            // Clear canvas or draw idle if analyser not ready
            if(canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0,0, canvas.width, canvas.height);
                ctx.fillStyle = '#000';
                ctx.fillRect(0,0, canvas.width, canvas.height);
            }
            if (this._ipodVisualizerFrame) cancelAnimationFrame(this._ipodVisualizerFrame);
            this._ipodVisualizerFrame = requestAnimationFrame(() => this.updateIpodVisualizer()); // Keep trying for idle
            return;
        }
        const ctx = canvas.getContext('2d'); // Define ctx here as it's used below
        const width = canvas.width; // Define width here
        const height = canvas.height; // Define height here

        // These were causing redeclaration errors if already in a scope accessible here.
        // Assuming they are needed for the logic below, ensure they are correctly scoped or passed.
        // For now, I will assume they are correctly defined in the outer scope if used by original logic.
        // If this.analyser.fftSize is the intended bufferLength, it should be used directly or assigned once.
        // this.analyser.getByteTimeDomainData(dataArray_analyser); // Already called above
        
        ctx.clearRect(0, 0, width, height);
        if (!this.isPlaying) {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, width, height);
            ctx.strokeStyle = 'rgba(106,13,173,0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            if (!this._idlePhase) this._idlePhase = 0;
            this._idlePhase += 0.01;
            for (let x = 0; x <= width; x++) {
                const y = height / 2 + Math.sin((x / width) * 4 * Math.PI + this._idlePhase) * (height * 0.08);
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            if (this._ipodVisualizerFrame) cancelAnimationFrame(this._ipodVisualizerFrame);
            this._ipodVisualizerFrame = requestAnimationFrame(() => this.updateIpodVisualizer());
            return;
        }
        // The following lines were using bufferLength and dataArray, ensure they use the correctly scoped ones
        // For clarity, using the suffixed versions if they are specific to this analyser instance.
        // this.analyser.getByteTimeDomainData(dataArray_analyser); // Already called above

        // Correctly get audio data for visualization when playing
        const bufferLength = this.analyser.fftSize; // Use fftSize for time domain data
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteTimeDomainData(dataArray);

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#6A0DAD';
        ctx.beginPath();
        let sliceWidth = width * 1.0 / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0; // dataArray[i] is 0-255, 128 is zero crossing
            const y = v * height / 2;    // Scale to canvas height (0 to height, with 128 mapping to height/2)
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            x += sliceWidth;
        }
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        if (this._ipodVisualizerFrame) cancelAnimationFrame(this._ipodVisualizerFrame);
        this._ipodVisualizerFrame = requestAnimationFrame(() => this.updateIpodVisualizer());
    }

    addWaveformTimelineEvents() {
        const canvas = document.getElementById('waveform-canvas');
        const container = document.getElementById('waveformContainer');
        if (!canvas || !container) return;
        let tooltip = document.getElementById('waveform-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'waveform-tooltip';
            tooltip.className = 'waveform-tooltip';
            container.appendChild(tooltip);
        }
        canvas.addEventListener('mousemove', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, x / rect.width));
            const previewTime = this.duration * ratio;
            this._waveformPreview = { x, time: previewTime };
            this.updateMainWaveform();
            tooltip.textContent = this.formatTime(previewTime);
            tooltip.style.left = `${x - tooltip.offsetWidth / 2}px`;
            tooltip.style.top = '-28px';
            tooltip.classList.add('visible');
        });
        canvas.addEventListener('mouseleave', () => {
            this._waveformPreview = null;
            this.updateMainWaveform();
            tooltip.classList.remove('visible');
        });
        canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const ratio = Math.max(0, Math.min(1, x / rect.width));
            const seekTime = this.duration * ratio;
            this.audio.currentTime = seekTime;
        });
    }

    formatTime(sec) {
        sec = Math.floor(sec);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    ensureWaveformTimelineEvents() {
        if (!this._waveformTimelineEventsAdded) {
            this.addWaveformTimelineEvents();
            this._waveformTimelineEventsAdded = true;
        }
    }

    getCurrentTrack() {
        return this.tracks.find(t => t.id === this.currentTrack);
    }

    getPlaybackState() {
        return {
            currentTrack: this.currentTrack,
            isPlaying: this.isPlaying,
            currentTime: this.currentTime,
            duration: this.duration,
            isMinimized: this.isMinimized,
            trackOrder: this.tracks.map(t => t.id)
        };
    }

    preloadNextTrack() {
        if (!this.currentTrack) return;

        const currentIndex = this.tracks.findIndex(t => t.id === this.currentTrack);
        if (currentIndex === -1) return;

        const nextIndex = (currentIndex + 1) % this.tracks.length;
        const nextTrack = this.tracks[nextIndex];

        if (nextTrack && this.secondaryAudio.src !== nextTrack.audio) {
            console.log(`Preloading next track: ${nextTrack.name}`);
            this.secondaryAudio.src = nextTrack.audio;
            this.secondaryAudio.load();
        }
    }

    renderTracklist(containerSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) {
            console.warn('Tracklist container not found:', containerSelector);
            return;
        }
        
        // Look for the track items container, or use the main container if not found
        const trackItemsContainer = container.querySelector('#track-items-container') || container;
        trackItemsContainer.innerHTML = ''; // Clear existing track items only

        this.tracks.forEach(track => {
            const trackItemEl = document.createElement('div');
            trackItemEl.className = 'track-item-card';
            trackItemEl.dataset.trackId = track.id;
            trackItemEl.setAttribute('draggable', true); // For drag & drop later

            const trackNameEl = document.createElement('span');
            trackNameEl.className = 'track-item-name';
            trackNameEl.textContent = track.name;
            trackItemEl.appendChild(trackNameEl);

            const dragHandleEl = document.createElement('span');
            dragHandleEl.className = 'track-item-drag-handle';
            dragHandleEl.innerHTML = '&#x2630;'; // Hamburger icon for drag
            trackItemEl.appendChild(dragHandleEl);
            
            trackItemEl.addEventListener('click', (e) => {
                // Prevent click from firing if dragging the handle
                if (e.target !== dragHandleEl) {
                    this.loadTrack(track.id, true);
                }
            });

            // Drag and drop event listeners will be added here later
            this.addDragDropEvents(trackItemEl);


            trackItemsContainer.appendChild(trackItemEl);
        });
        this.updatePlayingTrackInList(); // Initial update for playing class
    }

    updatePlayingTrackInList() {
        const trackItems = document.querySelectorAll('#tracklist-column .track-item-card');
        trackItems.forEach(item => {
            if (item.dataset.trackId === this.currentTrack && this.isPlaying) {
                item.classList.add('playing');
            } else {
                item.classList.remove('playing');
            }
        });
    }
    
    addDragDropEvents(trackItemEl) {
        trackItemEl.addEventListener('dragstart', this.handleDragStart.bind(this));
        trackItemEl.addEventListener('dragover', this.handleDragOver.bind(this));
        trackItemEl.addEventListener('dragleave', this.handleDragLeave.bind(this));
        trackItemEl.addEventListener('drop', this.handleDrop.bind(this));
        trackItemEl.addEventListener('dragend', this.handleDragEnd.bind(this));
    }

    handleDragStart(e) {
        this.draggedItem = e.target.closest('.track-item-card');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.draggedItem.dataset.trackId);
        // e.target.style.opacity = '0.5'; // Visual cue
        setTimeout(() => { // Use timeout to allow the browser to capture the drag image before hiding
            if (this.draggedItem) this.draggedItem.classList.add('dragging');
        }, 0);
    }

    handleDragOver(e) {
        e.preventDefault(); // Necessary to allow dropping
        e.dataTransfer.dropEffect = 'move';
        const targetItem = e.target.closest('.track-item-card');
        if (targetItem && targetItem !== this.draggedItem) {
            targetItem.classList.add('drag-over');
        }
    }

    handleDragLeave(e) {
        const targetItem = e.target.closest('.track-item-card');
        if (targetItem) {
            targetItem.classList.remove('drag-over');
        }
    }

    handleDrop(e) {
        e.preventDefault();
        const targetItem = e.target.closest('.track-item-card');
        if (!targetItem || targetItem === this.draggedItem) {
            if (this.draggedItem) this.draggedItem.classList.remove('dragging');
            document.querySelectorAll('.track-item-card.drag-over').forEach(el => el.classList.remove('drag-over'));
            this.draggedItem = null;
            return;
        }

        targetItem.classList.remove('drag-over');
        if (!this.draggedItem) return; // Should not happen if dragstart was successful

        const draggedId = this.draggedItem.dataset.trackId;
        const targetId = targetItem.dataset.trackId;

        const draggedIndex = this.tracks.findIndex(t => t.id === draggedId);
        let targetIndex = this.tracks.findIndex(t => t.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1) {
            console.error("Error finding tracks for drag/drop");
            if (this.draggedItem) this.draggedItem.classList.remove('dragging');
            this.draggedItem = null;
            return;
        }
        
        // Remove the dragged item and store it
        const [draggedTrack] = this.tracks.splice(draggedIndex, 1);

        // Adjust targetIndex if dragged item was before target
        if (draggedIndex < targetIndex) {
             // No need to adjust targetIndex because splice already shifted elements
        }
         // Re-find target index after splice if needed, or adjust logic
        targetIndex = this.tracks.findIndex(t => t.id === targetId); // Re-calculate targetIndex after splice

        if (targetIndex === -1) { // Dropped on the space where the item used to be, effectively end of list
            this.tracks.push(draggedTrack);
        } else {
             // Determine if dropping before or after the targetItem
             const rect = targetItem.getBoundingClientRect();
             const offsetY = e.clientY - rect.top;
             if (offsetY < rect.height / 2) { // Drop in upper half
                 this.tracks.splice(targetIndex, 0, draggedTrack);
             } else { // Drop in lower half
                 this.tracks.splice(targetIndex + 1, 0, draggedTrack);
             }
        }


        // this.tracks.splice(targetIndex, 0, draggedTrack); // Insert dragged item at target position (old logic)

        if (this.draggedItem) this.draggedItem.classList.remove('dragging');
        this.draggedItem = null;
        
        this.renderTracklist('#tracklist-column'); // Re-render the list with new order
        this.saveState(); // Save new track order
    }

    handleDragEnd(e) {
        // Clean up
        if (this.draggedItem) { // Check if draggedItem is not null
            this.draggedItem.classList.remove('dragging');
        }
        document.querySelectorAll('.track-item-card.drag-over').forEach(el => el.classList.remove('drag-over'));
        this.draggedItem = null;
    }
}

window.persistentPlayer = new PersistentMusicPlayer();

export default window.persistentPlayer;

function resizeIpodVisualizer() {
  const container = document.getElementById('ipodGreenScreen');
  const canvas = document.getElementById('ipod-visualizer');
  if (container && canvas) {
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
}
window.addEventListener('resize', resizeIpodVisualizer);
window.addEventListener('DOMContentLoaded', () => {
  resizeIpodVisualizer();
  if (window.persistentPlayer && typeof window.persistentPlayer.updateIpodVisualizer === 'function') {
    window.persistentPlayer.updateIpodVisualizer();
  }
});

function addFloatingWaveformEvents(player) {
  const floatingPlayer = document.getElementById('floating-player');
  if (!floatingPlayer) return;
  const canvas = floatingPlayer.querySelector('.floating-waveform');
  if (!canvas) return;
  let previewX = null;
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    previewX = e.clientX - rect.left;
    player._floatingWaveformPreview = previewX;
    player.updateFloatingWaveform();
  });
  canvas.addEventListener('mouseleave', () => {
    previewX = null;
    player._floatingWaveformPreview = null;
    player.updateFloatingWaveform();
  });
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const seekTime = player.duration * ratio;
    player.audio.currentTime = seekTime;
  });
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const rect = canvas.getBoundingClientRect();
      previewX = e.touches[0].clientX - rect.left;
      player._floatingWaveformPreview = previewX;
      player.updateFloatingWaveform();
    }
  });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      const rect = canvas.getBoundingClientRect();
      previewX = e.touches[0].clientX - rect.left;
      player._floatingWaveformPreview = previewX;
      player.updateFloatingWaveform();
    }
  });
  canvas.addEventListener('touchend', (e) => {
    if (previewX !== null) {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, previewX / rect.width));
      const seekTime = player.duration * ratio;
      player.audio.currentTime = seekTime;
      previewX = null;
      player._floatingWaveformPreview = null;
      player.updateFloatingWaveform();
    }
  });
}
window.addEventListener('DOMContentLoaded', () => {
  if (window.persistentPlayer) addFloatingWaveformEvents(window.persistentPlayer);
}); 