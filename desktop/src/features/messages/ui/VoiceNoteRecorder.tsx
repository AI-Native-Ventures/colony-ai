import * as React from "react";
import { useReducedMotion } from "motion/react";

import {
  formatVoiceNoteDuration,
  voiceNoteBarHeight,
} from "@/features/messages/lib/audioAttachment";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { TrashGlyph } from "./ComposerIcons";

/** 3px bars with a 3px gap, as the Composer states board draws the waveform. */
const BAR_PITCH_PX = 6;

/** The board's bars run 6 to 28px; the shared playback scale is 3 to 20px. */
function recorderBarHeight(level: number): number {
  return 6 + Math.round((voiceNoteBarHeight(level) - 3) * (22 / 17));
}

type WaveformSample = {
  id: string;
  level: number;
  recorded: boolean;
};

export function VoiceNoteRecorder({
  elapsedSeconds,
  levels,
  maxDurationSeconds,
  onCancel,
  processing,
  requesting,
}: {
  elapsedSeconds: number;
  levels: number[];
  maxDurationSeconds: number;
  onCancel: () => void;
  processing: boolean;
  requesting: boolean;
}) {
  const waveformRef = React.useRef<HTMLDivElement | null>(null);
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const previousFrameRef = React.useRef({ barCount: 0, levelCount: 0 });
  const prefersReducedMotion = useReducedMotion();
  const [barCount, setBarCount] = React.useState(1);

  React.useEffect(() => {
    const waveform = waveformRef.current;
    if (!waveform) return;
    const updateCount = () => {
      setBarCount(
        Math.min(
          1024,
          Math.max(1, Math.floor((waveform.clientWidth + 2) / BAR_PITCH_PX)),
        ),
      );
    };
    updateCount();
    const observer = new ResizeObserver(updateCount);
    observer.observe(waveform);
    return () => observer.disconnect();
  }, []);

  const visibleSamples = React.useMemo<WaveformSample[]>(() => {
    const startIndex = levels.length - barCount;
    return Array.from({ length: barCount }, (_, slot) => {
      const sampleIndex = startIndex + slot;
      return sampleIndex < 0
        ? {
            id: `baseline-${sampleIndex}`,
            level: 0,
            recorded: false,
          }
        : {
            id: `recorded-${sampleIndex}`,
            level: levels[sampleIndex] ?? 0,
            recorded: true,
          };
    });
  }, [barCount, levels]);

  React.useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const previous = previousFrameRef.current;
    const shouldAdvance =
      !prefersReducedMotion &&
      previous.barCount === barCount &&
      levels.length === previous.levelCount + 1;
    previousFrameRef.current = { barCount, levelCount: levels.length };

    track.style.transition = "none";
    track.style.transform = shouldAdvance
      ? `translate3d(${BAR_PITCH_PX}px, 0, 0)`
      : "translate3d(0, 0, 0)";
    if (!shouldAdvance) return;

    const frame = window.requestAnimationFrame(() => {
      track.style.transition = "transform 90ms linear";
      track.style.transform = "translate3d(0, 0, 0)";
    });
    return () => window.cancelAnimationFrame(frame);
  }, [barCount, levels.length, prefersReducedMotion]);

  return (
    <fieldset className="c3c-voice" data-testid="voice-note-recorder">
      <legend className="sr-only">
        {requesting
          ? "Waiting for microphone access"
          : processing
            ? "Preparing voice note"
            : "Recording voice note"}
      </legend>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <button
            aria-label="Discard voice note"
            className="c3c-voice-discard"
            onClick={onCancel}
            type="button"
          >
            <TrashGlyph />
          </button>
        </TooltipTrigger>
        <TooltipContent>Discard voice note</TooltipContent>
      </Tooltip>
      <span aria-hidden="true" className="c3c-voice-dot" />
      {requesting || processing ? (
        <span className="c3c-voice-time" data-quiet="true">
          {requesting ? "Waiting for microphone..." : "Preparing voice note..."}
        </span>
      ) : (
        <span className="c3c-voice-time">
          {formatVoiceNoteDuration(
            Math.min(elapsedSeconds, maxDurationSeconds),
          )}
          {` / ${formatVoiceNoteDuration(maxDurationSeconds)}`}
        </span>
      )}
      <div
        aria-hidden="true"
        className="c3c-voice-wave"
        data-testid="voice-note-live-waveform"
        ref={waveformRef}
      >
        <div
          className="c3c-voice-strip will-change-transform"
          data-testid="voice-note-waveform-strip"
          ref={trackRef}
        >
          {visibleSamples.map((sample) => (
            <span
              className="c3c-voice-bar"
              data-recorded-sample={sample.recorded ? "true" : undefined}
              data-waveform-sample={sample.id}
              key={sample.id}
              style={
                sample.recorded
                  ? { height: `${recorderBarHeight(sample.level)}px` }
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    </fieldset>
  );
}
