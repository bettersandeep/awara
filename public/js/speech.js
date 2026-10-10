// Plays spoken story lines in order and reports the playback position, so the
// story log can highlight the words being spoken. Autoplay starts off, because
// browsers block audio until the user interacts with the page.
export function createSpeech({ onSpeakerChange, onPosition }) {
  let autoplay = false;
  let queue = [];
  let current = null; // { audio, audioId, speaker }

  function reportPosition() {
    if (!current) return;
    onPosition(current.audioId, current.audio.currentTime);
    requestAnimationFrame(reportPosition);
  }

  function stop() {
    if (!current) return;
    current.audio.onended = null;
    current.audio.pause();
    onSpeakerChange(current.speaker, false);
    onPosition(current.audioId, null);
    current = null;
  }

  function playNext() {
    stop();
    const next = queue.shift();
    if (!next) return;
    const audio = new Audio(`audio/${next.audioId}.wav`);
    current = { audio, ...next };
    onSpeakerChange(next.speaker, true);
    audio.onended = playNext;
    audio.onerror = playNext;
    audio.play().then(reportPosition).catch(playNext);
  }

  return {
    toggleAutoplay() {
      autoplay = !autoplay;
      if (!autoplay) {
        queue = [];
        stop();
      }
      return autoplay;
    },
    // A new clip is ready: queue it when autoplay is on.
    clipReady(audioId, speaker) {
      if (!autoplay) return;
      queue.push({ audioId, speaker });
      if (!current) playNext();
    },
    // The user asked for this clip: play it now and drop the queue.
    playNow(audioId, speaker) {
      queue = [{ audioId, speaker }];
      playNext();
    },
  };
}
