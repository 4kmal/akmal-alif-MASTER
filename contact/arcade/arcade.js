/* Contact page arcade: loads the 3D cabinet + handheld beside the chat and launches EXEPERT
   in a full-window overlay. three.js is only fetched when the arcade is on screen (or the browser is idle on wide screens). */
import { ArcadeAudio } from './arcade-audio.js';

const GAME_URL = '/video-games/exepert/';
const WIDE = window.matchMedia('(min-width: 1280px)');
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function hasWebGL(){
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

function init(panel){
  const wrapper = panel.closest('.contact-wrapper');
  const stage = panel.querySelector('[data-arcade-stage]');
  const loading = panel.querySelector('[data-arcade-loading]');
  const fallback = panel.querySelector('[data-arcade-fallback]');
  const toggle = document.querySelector('[data-arcade-toggle]');
  const mute = panel.querySelector('[data-arcade-mute]');
  const audio = new ArcadeAudio();
  let scene = null, loadingScene = null, overlay = null, shown = WIDE.matches, closeTimer = null;

  const accent = () => getComputedStyle(document.body).getPropertyValue('--contact-retro-accent').trim() || '#00ff41';

  function ensureScene(){
    if (scene || loadingScene || !hasWebGL()) return loadingScene;
    loadingScene = import('./arcade-scene.js').then(({ createArcadeScene }) => {
      scene = createArcadeScene(stage, { audio, reducedMotion:REDUCED, accent:accent(), onLaunch:launch });
      scene.setVisible(shown && !overlay);
      panel.classList.add('is-ready');
      loading?.setAttribute('hidden', '');
      return scene;
    }).catch(error => {
      console.error('Arcade failed to load', error);
      showFallback();
    });
    return loadingScene;
  }

  function showFallback(){
    panel.classList.add('is-fallback');
    loading?.setAttribute('hidden', '');
    fallback?.removeAttribute('hidden');
  }

  function setOpen(open){
    wrapper.classList.toggle('arcade-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    if (toggle) toggle.querySelector('span').textContent = open ? 'CHAT' : 'ARCADE';
    shown = open || WIDE.matches;
    if (open){ ensureScene(); setTimeout(() => stage.focus({preventScroll:true}), 280); }
    scene?.setVisible(shown && !overlay);
  }

  /* ---------- launching EXEPERT ---------- */
  async function launch(opts = {}){
    if (overlay) return;
    audio.unlock();
    window.vortexPause?.();
    if (scene) await scene.zoomIntoScreen();
    const params = new URLSearchParams({ embed:'1' });
    if (opts.squad) params.set('squad', '1');
    overlay = document.createElement('div');
    overlay.className = 'arcade-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'EXEPERT');
    const frame = document.createElement('iframe');
    frame.src = `${GAME_URL}?${params}`;
    frame.title = 'EXEPERT';
    frame.allow = 'fullscreen; gamepad; autoplay; clipboard-write';
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'arcade-overlay__close'; close.textContent = '✕ ARCADE';
    close.addEventListener('click', closeOverlay);
    overlay.append(frame, close);
    document.body.append(overlay);
    document.documentElement.classList.add('arcade-playing');
    scene?.pause();
    requestAnimationFrame(() => overlay?.classList.add('is-open'));
    frame.addEventListener('load', () => frame.focus(), { once:true });
  }

  function closeOverlay(){
    if (!overlay) return;
    const el = overlay; overlay = null;
    el.classList.remove('is-open');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => el.remove(), 320);
    document.documentElement.classList.remove('arcade-playing');
    window.vortexResume?.();
    if (scene){ scene.resume(); scene.zoomOut(); }
    stage.focus({preventScroll:true});
  }

  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    if (e.data?.type === 'exepert:exit') closeOverlay();
    if (e.data?.type === 'exepert:ready') overlay?.classList.add('is-game-ready');
  });
  document.addEventListener('keydown', e => {
    if (overlay && e.key === 'Escape' && document.activeElement?.tagName !== 'IFRAME') closeOverlay();
  });

  /* ---------- wiring ---------- */
  panel.querySelector('[data-arcade-launch]')?.addEventListener('click', () => launch({}));
  toggle?.addEventListener('click', () => setOpen(!wrapper.classList.contains('arcade-open')));
  if (mute){
    const sync = () => { mute.setAttribute('aria-pressed', String(audio.muted)); mute.textContent = audio.muted ? '♪ OFF' : '♪ ON'; };
    mute.addEventListener('click', () => { audio.setMuted(!audio.muted); sync(); });
    sync();
  }
  WIDE.addEventListener?.('change', () => { shown = WIDE.matches || wrapper.classList.contains('arcade-open'); if (shown) ensureScene(); scene?.setVisible(shown && !overlay); });

  if (!hasWebGL()){ showFallback(); return; }
  const io = new IntersectionObserver(entries => {
    const vis = entries.some(e => e.isIntersecting);
    if (vis) ensureScene();
    scene?.setVisible(vis && shown && !overlay);
  }, { rootMargin:'120px' });
  io.observe(panel);
  if (WIDE.matches) (window.requestIdleCallback || (fn => setTimeout(fn, 1200)))(() => ensureScene());

  window.addEventListener('pagehide', e => { if (!e.persisted){ scene?.dispose(); scene = null; } else scene?.pause(); });
  window.addEventListener('pageshow', e => { if (e.persisted) scene?.resume(); });
}

const panel = document.querySelector('[data-arcade]');
if (panel) init(panel);
