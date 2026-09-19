import type { Game, Scene, Sound } from "phaser";

/** Freeze only activity suspended by the debugger; pre-existing pauses stay paused. */
export function createPreviewScenePause(game: Game) {
  const scenes = new Set<Scene>();
  const sounds = new Set<Sound.BaseSound>();
  const soundManager: Sound.BaseSoundManager = game.sound;
  return (paused: boolean): void => {
    if (paused) {
      for (const scene of game.scene.getScenes(true)) {
        if (scene.sys.isActive()) { scenes.add(scene); scene.sys.pause(); }
      }
      for (const sound of soundManager.getAll()) {
        if (sound.isPlaying) { sounds.add(sound); sound.pause(); }
      }
    } else {
      for (const scene of scenes) if (scene.sys.isPaused()) scene.sys.resume();
      for (const sound of sounds) if (sound.isPaused) sound.resume();
      scenes.clear(); sounds.clear();
    }
  };
}

/** Pause CSS/Web Animations and media, including media added while already paused. */
export function pausePreviewDom(root: HTMLElement): () => void {
  const animations = new Set<Animation>();
  const media = new Set<HTMLMediaElement>();
  root.setAttribute("data-debug-paused", "true");
  const pauseMedia = (element: HTMLMediaElement) => {
    if (!element.paused) { media.add(element); element.pause(); }
  };
  const scan = () => {
    if (typeof root.getAnimations === "function") {
      for (const animation of root.getAnimations({ subtree: true })) {
        if (animation.playState === "running") { animations.add(animation); animation.pause(); }
      }
    }
    root.querySelectorAll<HTMLMediaElement>("audio,video").forEach(pauseMedia);
  };
  const onPlay = (event: Event) => { if (event.target instanceof HTMLMediaElement) pauseMedia(event.target); };
  root.addEventListener("play", onPlay, true);
  root.addEventListener("animationstart", scan, true);
  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true });
  scan();
  return () => {
    observer.disconnect();
    root.removeEventListener("play", onPlay, true);
    root.removeEventListener("animationstart", scan, true);
    root.removeAttribute("data-debug-paused");
    for (const animation of animations) if (animation.playState === "paused") animation.play();
    for (const element of media) if (root.contains(element) && element.paused) void element.play().catch(() => {});
  };
}
