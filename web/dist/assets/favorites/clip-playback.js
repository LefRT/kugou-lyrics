(() => {
  'use strict';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  window.createJournalClipPlayback = (audio, { update, end, error }) => {
    let clip;
    let context;
    let gain;
    let triedAudioGraph = false;
    let requested = false;
    let revision = 0;
    let checkTimer = 0;
    let envelope;
    let fading;

    const stopTime = () => Number.isFinite(audio.duration)
      ? Math.min(clip.end, audio.duration) : clip.end;
    const length = () => clip ? Math.max(0, stopTime() - clip.start) : 0;

    function setLevel(level) {
      if (gain) {
        const now = context.currentTime;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(level, now);
      } else {
        audio.volume = level;
      }
    }

    function enableAudio() {
      if (!triedAudioGraph) {
        triedAudioGraph = true;
        try {
          context = new AudioContext();
          const gate = context.createGain();
          gate.gain.value = 0;
          context.createMediaElementSource(audio).connect(gate).connect(context.destination);
          gain = gate.gain;
          audio.volume = 1;
        } catch {
          context = undefined;
        }
      }
      if (context?.state !== 'running') void context?.resume().catch(() => {});
    }

    function stop() {
      revision++;
      requested = false;
      envelope = undefined;
      clearInterval(checkTimer);
      setLevel(0);
      audio.pause();
      if (fading) {
        clearInterval(fading.timer);
        fading.resolve();
        fading = undefined;
      }
      update();
    }

    function finish() {
      if (!requested) return;
      const reachedEnd = !fading;
      stop();
      if (reachedEnd) end();
    }

    function levelAt(time) {
      if (!envelope) return 0;
      const { start, attack, release } = envelope;
      return clamp(Math.min((time - start) / attack, (stopTime() - time) / release), 0, 1);
    }

    function check() {
      if (!requested || audio.paused || audio.seeking || fading) return;
      if (audio.currentTime >= stopTime()) {
        finish();
        return;
      }
      if (!gain) audio.volume = levelAt(audio.currentTime);
      update();
    }

    function startEnvelope() {
      if (!requested || fading || audio.paused || audio.seeking
          || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
      const start = audio.currentTime;
      const remaining = stopTime() - start;
      if (length() <= 0 || start < clip.start - .025) {
        stop();
        error();
        return;
      }
      if (remaining <= 0) {
        finish();
        return;
      }
      const attack = Math.min(.52, remaining / 2);
      const release = Math.min(.66, remaining / 2);
      envelope = { start, attack, release };
      setLevel(0);
      if (gain) {
        // The gain reaches zero at the clip boundary even if UI timers run late.
        const now = context.currentTime;
        gain.linearRampToValueAtTime(1, now + attack);
        gain.setValueAtTime(1, now + remaining - release);
        gain.linearRampToValueAtTime(0, now + remaining);
      }
    }

    function muteDuringSeek() {
      if (!fading) {
        envelope = undefined;
        setLevel(0);
      }
    }

    audio.addEventListener('playing', startEnvelope);
    audio.addEventListener('seeking', muteDuringSeek);
    audio.addEventListener('waiting', muteDuringSeek);
    audio.addEventListener('seeked', () => {
      if (!envelope) startEnvelope();
    });
    audio.addEventListener('ended', finish);
    audio.addEventListener('timeupdate', check);
    audio.addEventListener('error', () => {
      if (!clip) return;
      stop();
      error();
    });

    return {
      load(track) {
        stop();
        clip = track;
        if (audio.getAttribute('src') !== track.source || audio.error) audio.src = track.source;
        audio.currentTime = clip.start;
        update();
      },
      get duration() { return length(); },
      get position() { return clip ? clamp(audio.currentTime - clip.start, 0, length()) : 0; },
      get active() { return requested; },
      seek(time) {
        if (!clip || fading) return;
        muteDuringSeek();
        audio.currentTime = clip.start + clamp(time, 0, length());
        update();
      },
      play() {
        if (!clip || requested) return;
        if (audio.error) {
          audio.src = clip.source;
          audio.currentTime = clip.start;
        }
        if (audio.currentTime < clip.start || audio.currentTime >= stopTime() - .015) {
          audio.currentTime = clip.start;
        }
        enableAudio();
        setLevel(0);
        requested = true;
        const turn = ++revision;
        checkTimer = setInterval(check, 32);
        void audio.play().catch(() => {
          if (turn !== revision) return;
          stop();
          error();
        });
        update();
      },
      pause() {
        if (fading) return fading.promise;
        const fade = clip && !audio.paused ? clamp(stopTime() - audio.currentTime, 0, .34) : 0;
        const level = clip ? levelAt(audio.currentTime) : 0;
        if (!fade || !level) {
          stop();
          return Promise.resolve();
        }
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        if (gain) {
          const now = context.currentTime;
          if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
          else setLevel(level);
          gain.linearRampToValueAtTime(0, now + fade);
        }
        const began = performance.now();
        fading = { promise, resolve, timer: setInterval(() => {
          const ratio = (performance.now() - began) / (1000 * fade);
          if (ratio >= 1 || audio.ended) stop();
          else if (!gain) audio.volume = level * (1 - ratio);
        }, 20) };
        return promise;
      },
      stop,
    };
  };
})();
