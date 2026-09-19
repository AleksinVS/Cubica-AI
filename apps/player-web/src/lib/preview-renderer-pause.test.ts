import { describe, expect, it, vi } from "vitest";
import type { Game } from "phaser";
import { createPreviewScenePause, pausePreviewDom } from "./preview-renderer-pause";
function scene(active: boolean) {
  let state = active ? "running" : "paused";
  return { sys: { isActive: () => state === "running", isPaused: () => state === "paused",
    pause: vi.fn(() => { state = "paused"; }), resume: vi.fn(() => { state = "running"; }) } };
}
describe("confirmed renderer pause", () => {
  it("holds scene updates and sound without resuming independently paused scenes", () => {
    const running = scene(true), prePaused = scene(false);
    const scenes = [running, prePaused];
    const sound = { isPlaying: true, isPaused: false, pause: vi.fn(() => { sound.isPlaying = false; sound.isPaused = true; }), resume: vi.fn() };
    const apply = createPreviewScenePause({ scene: { getScenes: () => scenes }, sound: { getAll: () => [sound] } } as unknown as Game);
    apply(true); apply(true);
    expect(running.sys.pause).toHaveBeenCalledTimes(1); expect(sound.pause).toHaveBeenCalledTimes(1);
    const laterScene = scene(true); scenes.push(laterScene); apply(true);
    expect(laterScene.sys.pause).toHaveBeenCalledTimes(1);
    apply(false); expect(running.sys.resume).toHaveBeenCalledTimes(1); expect(laterScene.sys.resume).toHaveBeenCalledTimes(1);
    expect(prePaused.sys.resume).not.toHaveBeenCalled(); expect(sound.resume).toHaveBeenCalledTimes(1);
  });
  it("holds media started during pause and resumes only media held by the debugger", () => {
    const root = document.createElement("div"), video = document.createElement("video"), alreadyPaused = document.createElement("audio");
    root.append(video, alreadyPaused); document.body.append(root);
    let paused = true; Object.defineProperty(video, "paused", { get: () => paused });
    const pause = vi.spyOn(video, "pause").mockImplementation(() => { paused = true; });
    const play = vi.spyOn(video, "play").mockResolvedValue();
    const otherPlay = vi.spyOn(alreadyPaused, "play");
    const resume = pausePreviewDom(root);
    paused = false; video.dispatchEvent(new Event("play", { bubbles: false }));
    expect(pause).toHaveBeenCalledOnce(); expect(root.dataset.debugPaused).toBe("true");
    resume(); expect(play).toHaveBeenCalledOnce(); expect(otherPlay).not.toHaveBeenCalled();
    root.remove();
  });
});
