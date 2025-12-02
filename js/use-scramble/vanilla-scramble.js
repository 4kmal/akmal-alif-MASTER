/**
 * Vanilla JavaScript Scramble Text Effect
 * Based on use-scramble library by Tolis Christodoulou
 * Extracted and adapted from React hook to work with vanilla JS
 */

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomChar(range) {
  var rand = 0;
  if (range.length === 2) {
    rand = getRandomInt(range[0], range[1]);
  } else {
    rand = range[getRandomInt(0, range.length - 1)];
  }
  return String.fromCharCode(rand);
}

/**
 * Vanilla JS Scramble Text Class
 * Replicates the exact functionality of useScramble hook
 */
class VanillaScramble {
  constructor(element, props = {}) {
    // Extract props with defaults (matching useScramble exactly)
    const {
      playOnMount = true,
      text = element.textContent || '',
      speed = 1,
      seed = 1,
      step = 1,
      tick = 1,
      scramble = 1,
      chance = 1,
      overflow = true,
      range = [65, 125],
      overdrive = true,
      ignore = [' '],
      onAnimationStart = null,
      onAnimationFrame = null,
      onAnimationEnd = null
    } = props;

    // Store element and settings
    this.element = element;
    this.settings = {
      playOnMount,
      text,
      speed,
      seed,
      step,
      tick,
      scramble,
      chance,
      overflow,
      range,
      overdrive,
      ignore,
      onAnimationStart,
      onAnimationFrame,
      onAnimationEnd
    };

    // Check for reduced motion
    this.prefersReducedMotion = typeof window !== "undefined" ? 
      window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    
    if (this.prefersReducedMotion) {
      this.settings.step = text.length;
      this.settings.chance = 0;
      this.settings.overdrive = false;
    }

    // Initialize refs (equivalent to useRef in React)
    this.rafRef = 0;
    this.elapsedRef = 0;
    this.fpsInterval = 1000 / (60 * this.settings.speed);
    this.stepRef = 0;
    this.scrambleIndexRef = 0;
    this.controlRef = [];
    this.overdriveRef = 0;

    // Bind methods
    this.animate = this.animate.bind(this);
    this.play = this.play.bind(this);

    // Initialize
    this.reset();
    if (this.settings.playOnMount) {
      this.play();
    } else {
      this.controlRef = this.settings.text.split('');
      this.stepRef = this.settings.text.length;
      this.scrambleIndexRef = this.settings.text.length;
      this.overdriveRef = this.settings.text.length;
      this.draw();
      cancelAnimationFrame(this.rafRef);
    }
  }

  setIfNotIgnored(value, replace) {
    return this.settings.ignore.includes("" + value) ? value : replace;
  }

  seedForward() {
    if (this.scrambleIndexRef === this.settings.text.length) return;
    for (var i = 0; i < this.settings.seed; i++) {
      var index = getRandomInt(this.scrambleIndexRef, this.controlRef.length);
      if (typeof this.controlRef[index] !== 'number' && typeof this.controlRef[index] !== 'undefined') {
        this.controlRef[index] = this.setIfNotIgnored(
          this.controlRef[index], 
          getRandomInt(0, 10) >= (1 - this.settings.chance) * 10 ? 
            this.settings.scramble || this.settings.seed : 0
        );
      }
    }
  }

  stepForward() {
    for (var i = 0; i < this.settings.step; i++) {
      if (this.scrambleIndexRef < this.settings.text.length) {
        var currentIndex = this.scrambleIndexRef;
        var shouldScramble = getRandomInt(0, 10) >= (1 - this.settings.chance) * 10;
        this.controlRef[currentIndex] = this.setIfNotIgnored(
          this.settings.text[this.scrambleIndexRef], 
          shouldScramble ? 
            this.settings.scramble + getRandomInt(0, Math.ceil(this.settings.scramble / 2)) : 0
        );
        this.scrambleIndexRef++;
      }
    }
  }

  resizeControl() {
    if (this.settings.text.length < this.controlRef.length) {
      this.controlRef.pop();
      this.controlRef.splice(this.settings.text.length, this.settings.step);
    }
    for (var i = 0; i < this.settings.step; i++) {
      if (this.controlRef.length < this.settings.text.length) {
        this.controlRef.push(this.setIfNotIgnored(this.settings.text[this.controlRef.length + 1], null));
      }
    }
  }

  onOverdrive() {
    if (!this.settings.overdrive) return;
    for (var i = 0; i < this.settings.step; i++) {
      var max = Math.max(this.controlRef.length, this.settings.text.length);
      if (this.overdriveRef < max) {
        this.controlRef[this.overdriveRef] = this.setIfNotIgnored(
          this.settings.text[this.overdriveRef], 
          String.fromCharCode(typeof this.settings.overdrive === 'boolean' ? 95 : this.settings.overdrive)
        );
        this.overdriveRef++;
      }
    }
  }

  onTick() {
    this.stepForward();
    this.resizeControl();
    this.seedForward();
  }

  animate(time) {
    if (!this.settings.speed) return;
    this.rafRef = requestAnimationFrame(this.animate);
    this.onOverdrive();
    var timeElapsed = time - this.elapsedRef;
    if (timeElapsed > this.fpsInterval) {
      this.elapsedRef = time;
      if (this.stepRef % this.settings.tick === 0) {
        this.onTick();
      }
      this.draw();
    }
  }

  draw() {
    if (!this.element) return;
    var result = '';
    for (var i = 0; i < this.controlRef.length; i++) {
      var controlValue = this.controlRef[i];
      switch (true) {
        case typeof controlValue === 'number' && controlValue > 0:
          result += getRandomChar(this.settings.range);
          if (i <= this.scrambleIndexRef) {
            this.controlRef[i] = this.controlRef[i] - 1;
          }
          break;
        case typeof controlValue === 'string' && (i >= this.settings.text.length || i >= this.scrambleIndexRef):
          result += controlValue;
          break;
        case controlValue === this.settings.text[i] && i < this.scrambleIndexRef:
          result += this.settings.text[i];
          break;
        case controlValue === 0 && i < this.settings.text.length:
          result += this.settings.text[i];
          this.controlRef[i] = this.settings.text[i];
          break;
        default:
          result += '';
      }
    }
    
    // Set text content
    this.element.textContent = result;
    
    if (this.settings.onAnimationFrame) {
      this.settings.onAnimationFrame(result);
    }
    
    // Check if animation is complete
    if (result === this.settings.text) {
      this.controlRef.splice(this.settings.text.length, this.controlRef.length);
      if (this.settings.onAnimationEnd) {
        this.settings.onAnimationEnd();
      }
      cancelAnimationFrame(this.rafRef);
    }
    this.stepRef++;
  }

  reset() {
    this.stepRef = 0;
    this.scrambleIndexRef = 0;
    this.overdriveRef = 0;
    if (!this.settings.overflow) {
      this.controlRef = new Array(this.settings.text?.length || 0);
    }
  }

  // This is the key method - equivalent to replay() from useScramble
  play() {
    cancelAnimationFrame(this.rafRef);
    this.reset();
    if (this.settings.onAnimationStart) {
      this.settings.onAnimationStart();
    }
    this.rafRef = requestAnimationFrame(this.animate);
  }

  // Update text (for when content changes)
  updateText(newText) {
    this.settings.text = newText;
    this.reset();
  }

  // Cleanup
  destroy() {
    cancelAnimationFrame(this.rafRef);
    if (this.element) {
      this.element.textContent = this.settings.text;
    }
  }
}

// Create a factory function that matches ScrambleText.tsx behavior
function createScrambleText(element, settings = {}) {
  // Use the exact default settings from ScrambleText.tsx:25
  const defaultSettings = {
    speed: 0.8,
    tick: 1,
    step: 2.3,
    scramble: 10,
    chance: 0.8,
    overdrive: false,
    playOnMount: false // Don't auto-play, wait for hover/focus
  };

  const finalSettings = { ...defaultSettings, ...settings };
  
  const scrambler = new VanillaScramble(element, finalSettings);
  
  // Add the replay functionality (triggered on hover/focus like ScrambleText.tsx:46)
  const replay = () => {
    scrambler.play();
  };

  return {
    replay,
    updateText: (newText) => {
      element.textContent = newText;
      scrambler.updateText(newText);
    },
    destroy: () => {
      scrambler.destroy();
    }
  };
}

// Export for global use
window.createScrambleText = createScrambleText;
window.VanillaScramble = VanillaScramble;