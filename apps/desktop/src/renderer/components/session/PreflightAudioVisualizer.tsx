import type { SessionUiState } from "../../../shared/session-ui-state";

export function PreflightAudioVisualizer({ sessionUi }: { sessionUi: SessionUiState }) {
  const width = `${Math.round(sessionUi.preflight.level.rms * 100)}%`;
  return (
    <div className="preflightMeter">
      <div className="meterTrack"><span className="meterFill" style={{ width }} /></div>
      <p>{sessionUi.preflight.warning ?? "音频输入正常，可以开始。"}</p>
    </div>
  );
}
