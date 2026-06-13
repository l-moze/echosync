import type { SessionUiState } from "../../shared/session-ui-state";

export function pageTitleForSession(sessionUi: SessionUiState) {
  if (sessionUi.startup.phase !== "idle") {
    return "启动同传";
  }
  if (sessionUi.lifecycle === "active") {
    return "正在同传";
  }
  if (sessionUi.lifecycle === "finished") {
    return "会话复盘";
  }
  return "EchoSync";
}
