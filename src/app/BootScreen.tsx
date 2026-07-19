import type { ModelLoadProgress } from "../workers/worker-messages";

export type FieldLoadProgress = {
  status: "loading" | "ready" | "skipped";
  progress: number;
};

type BootScreenProps = {
  transcription: ModelLoadProgress | null;
  embeddings: ModelLoadProgress | null;
  /** Entry-preview field settle — skipped when restoring a saved session. */
  field: FieldLoadProgress | null;
  visible: boolean;
};

function progressValue(progress: ModelLoadProgress | null): number {
  if (!progress) {
    return 0;
  }
  if (progress.status === "ready" || progress.status === "error") {
    return 1;
  }
  return Math.min(1, Math.max(0, progress.progress));
}

function fieldProgressValue(field: FieldLoadProgress | null): number | null {
  if (!field || field.status === "skipped") {
    return null;
  }
  if (field.status === "ready") {
    return 1;
  }
  return Math.min(1, Math.max(0, field.progress));
}

export function BootScreen({
  transcription,
  embeddings,
  field,
  visible,
}: BootScreenProps) {
  const fieldValue = fieldProgressValue(field);
  const parts =
    fieldValue === null
      ? [progressValue(transcription), progressValue(embeddings)]
      : [
          progressValue(transcription),
          progressValue(embeddings),
          fieldValue,
        ];
  const overall =
    parts.reduce((sum, value) => sum + value, 0) / Math.max(1, parts.length);
  const percent = Math.round(overall * 100);

  return (
    <div
      className={`boot-screen${visible ? " is-visible" : ""}`}
      aria-hidden={!visible}
      aria-busy={visible}
      aria-label="Loading"
    >
      <div
        className="boot-screen-inner"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="boot-screen-percent">{percent}</span>
        <div className="boot-screen-track">
          <div
            className="boot-screen-line"
            style={{ transform: `scaleX(${overall})` }}
          />
        </div>
      </div>
    </div>
  );
}
