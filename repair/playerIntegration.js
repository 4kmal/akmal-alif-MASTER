// js/modules/playerIntegration.js - Integration between UI and Persistent Player

// Helper function to format time (seconds to MM:SS)
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
}

class PlayerIntegration {
    constructor(persistentPlayer) {
        this.player = persistentPlayer;
        this.isInitialized = false;
        this.currentlyPlayingTrackElement = null;
        this.isScrubbing = false;
        this.isLoadingFirstTrack = false;
    }

    async init() {
        if (this.isInitialized) return;
        
        // Wait for DOM elements to be available
        await this.waitForElements();
        
        // Initialize the core player (loads waveforms, etc.)
        // This needs to happen before UI elements that depend on track data (like tracklist)
        if (this.player && typeof this.player.init === 'function') {
            await this.player.init(); 
        }
        
        // Setup event listeners
        this.setupPlayerControls();
        // this.setupTrackList(); // Old tracklist setup - REMOVE/COMMENT OUT
        this.setupWaveformInteraction();
        this.setupMinimizeButton();
        this.setupVolumeControl();
        this.setupTimelineHoverEffect();
        
        // Render the new interactive tracklist
        if (this.player && typeof this.player.renderTracklist === 'function') {
            this.player.renderTracklist('#tracklist-column');
        }
        
        // Initialize UI state
        this.updateAllUI();
        
        this.hookCdRotationToPlayer();
        
        this.isInitialized = true;
        console.log('Player integration initialized');
    }

    async waitForElements() {
        const checkElements = () => {
            // Check for essential player controls and the new tracklist container
            return document.getElementById('playPauseBtn') && 
                   document.getElementById('waveform-canvas') &&
                   document.getElementById('waveformContainer') && // Ensure waveform container exists
                   document.getElementById('tracklist-column');
        };

        if (checkElements()) return;

        return new Promise(resolve => {
            const observer = new MutationObserver(() => {
                if (checkElements()) {
                    observer.disconnect();
                    resolve();
                }
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    }

    setupPlayerControls() {
        // Play/Pause Button
        const playPauseBtn = document.getElementById('playPauseBtn');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', async () => {
                if (this.player.isPlaying) {
                    this.player.pause();
                } else {
                    if (!this.player.currentTrack && !this.isLoadingFirstTrack) {
                        this.isLoadingFirstTrack = true;
                        await this.player.loadTrack('track1', true);
                        this.isLoadingFirstTrack = false;
                    } else if (this.player.currentTrack) {
                        await this.player.play();
                    }
                }
            });
        }

        // Previous Button
        const prevBtn = document.getElementById('prevBtn');
        if (prevBtn) {
            prevBtn.addEventListener('click', async () => {
                await this.player.playPrevious();
            });
        }

        // Next Button
        const nextBtn = document.getElementById('nextBtn');
        if (nextBtn) {
            nextBtn.addEventListener('click', async () => {
                await this.player.playNext();
            });
        }

        // Loop Button
        const loopBtn = document.getElementById('loopBtn');
        if (loopBtn) {
            loopBtn.addEventListener('click', () => {
                this.player.audio.loop = !this.player.audio.loop;
                loopBtn.classList.toggle('active', this.player.audio.loop);
            });
        }

        // Download Button
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                this.downloadCurrentTrack();
            });
        }
    }

    setupWaveformInteraction() {
        const waveformContainer = document.getElementById('waveformContainer');
        const progressBar = document.getElementById('progressBar');
        
        if (!waveformContainer || !progressBar) return;

        // Click to seek on waveform
        waveformContainer.addEventListener('click', (e) => {
            const rect = waveformContainer.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const percentage = (x / rect.width) * 100;
            
            this.player.seek(percentage);
            this.updateProgressBar(percentage);
        });

        // Progress bar scrubbing
        let isScrubbing = false;
        
        progressBar.addEventListener('mousedown', () => {
            isScrubbing = true;
        });

        progressBar.addEventListener('input', () => {
            if (isScrubbing) {
                const percentage = parseFloat(progressBar.value);
                this.updateProgressBar(percentage);
            }
        });

        progressBar.addEventListener('change', () => {
            if (isScrubbing) {
                const percentage = parseFloat(progressBar.value);
                this.player.seek(percentage);
                isScrubbing = false;
            }
        });

        document.addEventListener('mouseup', () => {
            if (isScrubbing) {
                isScrubbing = false;
            }
        });
    }

    setupMinimizeButton() {
        const minimizeBtn = document.getElementById('playerMinimizeBtn');
        if (minimizeBtn) {
            minimizeBtn.addEventListener('click', () => {
                this.player.minimize();
            });
        }
    }

    setupVolumeControl() {
        const volumeSlider = document.getElementById('volumeSlider');
        const volumePercentage = document.getElementById('volumePercentage');
        
        if (volumeSlider) {
            volumeSlider.addEventListener('input', () => {
                const volume = parseFloat(volumeSlider.value);
                this.player.setVolume(volume);
                
                if (volumePercentage) {
                    volumePercentage.textContent = Math.round(volume * 100) + '%';
                }
            });

            // Mouse wheel volume control
            volumeSlider.addEventListener('wheel', (e) => {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -0.05 : 0.05;
                const newVolume = Math.max(0, Math.min(1, parseFloat(volumeSlider.value) + delta));
                
                volumeSlider.value = newVolume;
                this.player.setVolume(newVolume);
                
                if (volumePercentage) {
                    volumePercentage.textContent = Math.round(newVolume * 100) + '%';
                }
            }, { passive: false });
        }
    }

    setupTimelineHoverEffect() {
        const waveformContainer = document.getElementById('waveformContainer');
        const previewLine = document.getElementById('waveformPreviewLine');
        const tooltip = document.getElementById('waveformTooltip');

        if (!waveformContainer || !previewLine || !tooltip || !this.player) {
            console.warn('Timeline hover effect elements not found or player not ready.');
            return;
        }

        waveformContainer.addEventListener('mouseenter', () => {
            if (this.player.duration > 0) { // Only show if there's a track loaded
                previewLine.style.display = 'block';
                tooltip.classList.add('visible');
            }
        });

        waveformContainer.addEventListener('mousemove', (event) => {
            if (this.player.duration <= 0) return; // No track loaded or duration is zero

            const rect = waveformContainer.getBoundingClientRect();
            let relativeX = event.clientX - rect.left;

            // Clamp relativeX to be within the bounds of the container
            relativeX = Math.max(0, Math.min(relativeX, rect.width));

            const progressPercentage = relativeX / rect.width;
            const hoverTime = progressPercentage * this.player.duration;

            previewLine.style.left = `${relativeX}px`;
            tooltip.textContent = formatTime(hoverTime);
            
            // Position tooltip: try to center it above the line, but keep it within bounds
            const tooltipWidth = tooltip.offsetWidth;
            let tooltipLeft = relativeX - (tooltipWidth / 2);
            tooltipLeft = Math.max(0, Math.min(tooltipLeft, rect.width - tooltipWidth)); // Ensure tooltip stays within waveform container
            
            tooltip.style.left = `${tooltipLeft}px`;
            tooltip.style.bottom = `${rect.height + 5}px`; // Position above the waveform
        });

        waveformContainer.addEventListener('mouseleave', () => {
            previewLine.style.display = 'none';
            tooltip.classList.remove('visible');
        });
    }

    updateAllUI() {
        this.updatePlayPauseButton();
        this.updateTrackDisplay();
        this.updateProgressBar();
        this.updateTrackSelection();
        this.updateVolumeDisplay();
    }

    updatePlayPauseButton() {
        const playIcon = document.getElementById('playIcon');
        const pauseIcon = document.getElementById('pauseIcon');
        
        if (playIcon && pauseIcon) {
            playIcon.style.display = this.player.isPlaying ? 'none' : 'block';
            pauseIcon.style.display = this.player.isPlaying ? 'block' : 'none';
        }
    }

    updateTrackDisplay() {
        const trackNameElement = document.querySelector('.track-name');
        const cdImage = document.getElementById('mainPlayerCdInsert') || document.querySelector('.cd-insert');
        
        if (this.player.currentTrack) {
            const track = this.player.getCurrentTrack();
            
            if (trackNameElement && track) {
                trackNameElement.textContent = track.name;
            }
            
            if (cdImage && track) {
                cdImage.src = track.cd;
            }
        }
    }

    updateProgressBar(percentage = null) {
        const progressBar = document.getElementById('progressBar');
        const progressFill = document.getElementById('progressFill');
        
        if (percentage === null) {
            percentage = this.player.duration ? 
                (this.player.currentTime / this.player.duration) * 100 : 0;
        }
        
        if (progressBar) {
            progressBar.value = percentage;
        }
        
        if (progressFill) {
            progressFill.style.width = percentage + '%';
        }
    }

    updateTrackSelection(selectedElement = null) {
        // Remove previous selection
        if (this.currentlyPlayingTrackElement) {
            this.currentlyPlayingTrackElement.classList.remove('playing');
        }
        
        // Find current track element if not provided
        if (!selectedElement && this.player.currentTrack) {
            selectedElement = document.querySelector(`[data-track-id="${this.player.currentTrack}"]`);
        }
        
        // Update selection
        if (selectedElement) {
            selectedElement.classList.add('playing');
            this.currentlyPlayingTrackElement = selectedElement;
        }
    }

    updateVolumeDisplay() {
        const volumeSlider = document.getElementById('volumeSlider');
        const volumePercentage = document.getElementById('volumePercentage');
        
        if (volumeSlider) {
            volumeSlider.value = this.player.audio.volume;
        }
        
        if (volumePercentage) {
            volumePercentage.textContent = Math.round(this.player.audio.volume * 100) + '%';
        }
    }

    downloadCurrentTrack() {
        if (!this.player.currentTrack) {
            alert('No track selected for download');
            return;
        }

        const track = this.player.getCurrentTrack();
        if (!track) return;

        // Create download link
        const link = document.createElement('a');
        link.href = track.audio;
        link.download = track.name.replace(/[^a-zA-Z0-9]/g, '_') + '.mp3';
        
        // Trigger download
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Public methods for external control
    play() {
        return this.player.play();
    }

    pause() {
        this.player.pause();
    }

    next() {
        this.player.playNext();
    }

    previous() {
        this.player.playPrevious();
    }

    loadTrack(trackId, autoPlay = false) {
        return this.player.loadTrack(trackId, autoPlay);
    }

    minimize() {
        this.player.minimize();
    }

    maximize() {
        this.player.maximize();
    }

    getState() {
        return this.player.getPlaybackState();
    }

    // --- Animate CD rotation in iPod ---
    animateCdRotation() {
        const cdImage = document.getElementById('mainPlayerCdInsert');
        if (!cdImage || !this.player.isPlaying || !this.player.duration) return;
        const progress = this.player.currentTime / this.player.duration;
        const totalRotations = 20;
        const rotationAngle = progress * totalRotations * 360;
        cdImage.style.transform = `rotate(${rotationAngle}deg)`;
        if (this.player.isPlaying) {
            this.cdAnimationFrame = requestAnimationFrame(() => this.animateCdRotation());
        }
    }

    stopCdRotation() {
        if (this.cdAnimationFrame) {
            cancelAnimationFrame(this.cdAnimationFrame);
            this.cdAnimationFrame = null;
        }
    }

    // --- Hook into player events ---
    hookCdRotationToPlayer() {
        // Stop any previous animation
        this.stopCdRotation();
        // Start animation if playing
        if (this.player.isPlaying) {
            this.animateCdRotation();
        }
        // Listen for play/pause events
        this.player.audio.addEventListener('play', () => this.animateCdRotation());
        this.player.audio.addEventListener('pause', () => this.stopCdRotation());
        this.player.audio.addEventListener('ended', () => this.stopCdRotation());
    }
}

// Auto-initialize when persistent player is available
if (window.persistentPlayer) {
    window.playerIntegration = new PlayerIntegration(window.persistentPlayer);
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.playerIntegration.init();
        });
    } else {
        window.playerIntegration.init();
    }
}

export default PlayerIntegration;

// -------- Tracklist Drag and Drop --------
let draggedItem = null;

function handleDragStart(e) {
    draggedItem = e.target;
    setTimeout(() => {
        if (e.target && typeof e.target.classList !== 'undefined') { // Check if e.target is a valid element
            e.target.classList.add('dragging');
        }
    }, 0);
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
    }
}

function handleDragEnd(e) {
    setTimeout(() => {
        if (e.target && typeof e.target.classList !== 'undefined') { // Check if e.target is a valid element
            e.target.classList.remove('dragging');
        }
        draggedItem = null;
    }, 0);
}

function handleDragOver(e) {
    e.preventDefault(); 
    if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
    }
    const targetItem = e.target.closest('.track-item-card');
    if (targetItem && targetItem !== draggedItem) {
        targetItem.classList.add('drag-over'); 
    }
}

function handleDragEnter(e) {
    e.preventDefault();
    const targetItem = e.target.closest('.track-item-card');
    if (targetItem && targetItem !== draggedItem) {
        targetItem.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    const targetItem = e.target.closest('.track-item-card');
    if (targetItem) {
        targetItem.classList.remove('drag-over');
    }
}

function handleDrop(e) {
    e.preventDefault();
    const targetItem = e.target.closest('.track-item-card');
    if (targetItem && draggedItem && targetItem !== draggedItem) {
        const trackItemsContainer = targetItem.parentNode;
        if (trackItemsContainer) { // Ensure parentNode exists
            const targetRect = targetItem.getBoundingClientRect();
            const mouseY = e.clientY;
            if (mouseY < targetRect.top + targetRect.height / 2) {
                trackItemsContainer.insertBefore(draggedItem, targetItem);
            } else {
                trackItemsContainer.insertBefore(draggedItem, targetItem.nextSibling);
            }
        }
    }
    if (targetItem) {
        targetItem.classList.remove('drag-over');
    }
}

export function initTracklistDragAndDrop() {
    const trackItemsContainer = document.getElementById('track-items-container');
    if (!trackItemsContainer) {
        console.warn('Track items container not found for drag and drop init.');
        return;
    }
    trackItemsContainer.addEventListener('dragstart', handleDragStart);
    trackItemsContainer.addEventListener('dragend', handleDragEnd);
    trackItemsContainer.addEventListener('dragover', handleDragOver);
    trackItemsContainer.addEventListener('dragenter', handleDragEnter);
    trackItemsContainer.addEventListener('dragleave', handleDragLeave);
    trackItemsContainer.addEventListener('drop', handleDrop);
    console.log('Tracklist drag and drop initialized for container.');
}

// Ensure this init function is called after the tracklist panel and its items are loaded.
// This might be called from your main script.js after loadPartials completes and
// after your music player populates the track items.

// Example of how you might call it from script.js (conceptual):
// playerIntegration.initTracklistDragAndDrop(); // After tracks are in the DOM


// Existing init function in playerIntegration.js
export function init() {
    console.log("Player integration module initialized.");
    // Add other initializations here if needed
    setupEventListeners();
    // Potentially call initTracklistDragAndDrop() here if track items
    // are guaranteed to be populated by the time setupEventListeners or other logic runs.
    // However, it's safer to call it more explicitly after dynamic content is loaded.
}

// Make sure to call initTracklistDragAndDrop from your main script after tracklist items are populated.
// For example, in script.js, after loadPartials and after the function that populates the tracklist runs:
// if (window.playerIntegration && typeof window.playerIntegration.initTracklistDragAndDrop === 'function') {
//   window.playerIntegration.initTracklistDragAndDrop();
// } 