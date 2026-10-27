// Plays the motions of each story beat on the board when the voice reaches that
// beat. The voice can take longer than the line to generate (Kokoro needs about
// 12 s for 80 words), so motions wait for their clip, not for a fixed time.
// Without the voice, motions play one beat after another as the line appears.
const BEAT_SECONDS_WITHOUT_VOICE = 1.6;
// A line that never gets a clip (no speech engine) plays its motions after this.
const NO_CLIP_WAIT_MS = 30_000;

/**
 * @param {object} options
 * @param {(motions: { id: string, action: string, target?: string }[]) => void} options.playMotions
 * @param {() => boolean} options.isVoiceOn
 * @param {(fn: () => void, ms: number) => any} [options.setTimer] for tests; setTimeout by default
 * @param {(id: any) => void} [options.clearTimer] for tests; clearTimeout by default
 */
export function createStoryMotions({ playMotions, isVoiceOn, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const lines = new Map(); // logIndex -> { pieces, played: Set of piece indexes, noClipTimer, audioId }
  const lineByAudioId = new Map();

  function playPiece(line, index) {
    if (line.played.has(index) || !line.pieces[index]?.motions) return;
    line.played.add(index);
    playMotions(line.pieces[index].motions);
  }

  // The motions this line has not played yet, one beat apart.
  function playRest(line) {
    clearTimer(line.noClipTimer);
    let beat = 0;
    line.pieces.forEach((piece, index) => {
      if (!piece.motions || line.played.has(index)) return;
      line.played.add(index); // reserved now, so a late voice does not play it twice
      setTimer(() => playMotions(piece.motions), beat * BEAT_SECONDS_WITHOUT_VOICE * 1000);
      beat++;
    });
  }

  return {
    // A story line arrived. History replayed to a new page is not acted out again.
    lineAdded(entry) {
      if (entry.replay || !entry.pieces?.some((piece) => piece.motions)) return;
      const line = { pieces: entry.pieces, played: new Set() };
      lines.set(entry.logIndex, line);
      if (isVoiceOn()) line.noClipTimer = setTimer(() => playRest(line), NO_CLIP_WAIT_MS);
      else playRest(line);
    },
    // The clip for a line exists; its motions now follow the voice.
    clipReady(logIndex, audioId) {
      const line = lines.get(logIndex);
      if (!line) return;
      clearTimer(line.noClipTimer);
      line.audioId = audioId;
      lineByAudioId.set(audioId, line);
    },
    pieceSpoken(logIndex, pieceIndex) {
      const line = lines.get(logIndex);
      if (!line) return;
      clearTimer(line.noClipTimer);
      for (let i = 0; i <= pieceIndex; i++) playPiece(line, i);
    },
    // The clip ended, stopped or failed: whatever it did not reach plays now.
    clipStopped(audioId) {
      const line = lineByAudioId.get(audioId);
      if (line) playRest(line);
    },
    // The voice was turned off: nothing waits for it any more.
    voiceOff() {
      for (const line of lines.values()) playRest(line);
    },
    clear() {
      for (const line of lines.values()) clearTimer(line.noClipTimer);
      lines.clear();
      lineByAudioId.clear();
    },
  };
}
