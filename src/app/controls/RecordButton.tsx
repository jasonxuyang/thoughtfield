import { MicWaveform } from "./MicWaveform";

type RecordButtonProps = {
  listening: boolean;
  ready: boolean;
  stream: MediaStream | null;
  onToggle: () => void;
};

/** Waveform + mic/stop in one control — lives in the transcript chrome. */
export function RecordButton({
  listening,
  ready,
  stream,
  onToggle,
}: RecordButtonProps) {
  const label = listening ? "Stop recording" : "Use voice";

  return (
    <div className={`mic-control${listening ? " is-listening" : ""}`}>
      <button
        type="button"
        className="mic-transport"
        onClick={onToggle}
        disabled={!ready && !listening}
        aria-label={label}
        aria-pressed={listening}
      >
        <svg
          className="mic-transport-icon"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
        >
          {listening ? (
            <rect x="5" y="5" width="14" height="14" fill="currentColor" />
          ) : (
            <path
              fill="currentColor"
              d="M12 2a3.5 3.5 0 0 0-3.5 3.5v6a3.5 3.5 0 1 0 7 0v-6A3.5 3.5 0 0 0 12 2Zm-6 9.5a1 1 0 1 0-2 0 8 8 0 0 0 7 7.94V21H8.5a1 1 0 1 0 0 2h7a1 1 0 1 0 0-2H13v-1.56A8 8 0 0 0 20 11.5a1 1 0 1 0-2 0 6 6 0 1 1-12 0Z"
            />
          )}
        </svg>
      </button>
      {listening ? <MicWaveform stream={stream} active /> : null}
    </div>
  );
}
