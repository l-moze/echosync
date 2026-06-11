import type { SessionUiState } from "../../shared/session-ui-state";
import type { SessionRecord, SessionRecordExportFormat } from "../../shared/session-records";
import type { SubtitleDisplayMode } from "../../shared/subtitle-style-state";
import { subtitleDisplayModeLabel } from "../../shared/subtitle-style-state";
import { DESKTOP_AUDIO_SOURCES, type DesktopAudioSource, type DesktopAudioSourceId } from "../../shared/audio-source-catalog";

export function termStatusLabel(status: SessionUiState["terms"][number]["status"]) {
  const labels: Record<SessionUiState["terms"][number]["status"], string> = {
    active: "已生效",
    failed: "失败",
    syncing: "同步中"
  };
  return labels[status];
}

export function sessionRecordExportFormatLabel(format: SessionRecordExportFormat) {
  const labels: Record<SessionRecordExportFormat, string> = {
    markdown: "Markdown",
    srt: "SRT",
    txt: "TXT"
  };
  return labels[format];
}

export function sessionRecordSummaryStatusLabel(status: SessionRecord["summary"]["status"]) {
  const labels: Record<SessionRecord["summary"]["status"], string> = {
    failed: "摘要生成失败",
    pending: "摘要待生成",
    ready: "摘要已生成"
  };
  return labels[status];
}

export function overlayDisplayModeAccessibleLabel(mode: SubtitleDisplayMode) {
  return mode === "sentencePair" ? "逐句对照" : "分区对照";
}

export function styleOptionLabel(value: string) {
  const labels: Record<string, string> = {
    sentencePair: subtitleDisplayModeLabel("sentencePair"),
    zonedPair: subtitleDisplayModeLabel("zonedPair"),
    shadow: "阴影",
    outline: "描边",
    none: "无"
  };
  return labels[value] ?? value;
}

export function sourceLabel(sourceId: DesktopAudioSourceId) {
  return DESKTOP_AUDIO_SOURCES.find((source: DesktopAudioSource) => source.id === sourceId)?.label ?? "未知来源";
}

export function engineOptionLabel(label: string, id: string) {
  if (id === "server-default") {
    return "自动";
  }
  return label;
}
