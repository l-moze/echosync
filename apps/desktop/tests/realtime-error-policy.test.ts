import { describe, expect, it } from "vitest";

import { shouldSurfaceRealtimeError } from "../src/shared/realtime-error-policy";

describe("实时错误显示策略", () => {
  it("用户主动停止中的 session 错误只进日志，不显示到字幕面板", () => {
    expect(
      shouldSurfaceRealtimeError(
        {
          type: "realtime.error",
          session_id: "sess_stopping",
          message: "Realtime pipeline cancelled after user stop"
        },
        {
          stoppingSessionIds: new Set(["sess_stopping"])
        }
      )
    ).toBe(false);
  });

  it("非用户停止 session 的 realtime.error 仍然显示", () => {
    expect(
      shouldSurfaceRealtimeError(
        {
          type: "realtime.error",
          session_id: "sess_active",
          message: "Voxtral realtime failed"
        },
        {
          stoppingSessionIds: new Set(["sess_other"])
        }
      )
    ).toBe(true);
  });
});
