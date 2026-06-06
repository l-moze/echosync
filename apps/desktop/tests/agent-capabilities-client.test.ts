import { describe, expect, it, vi } from "vitest";

import {
  agentHttpBaseUrlFromCaptionWsUrl,
  fetchAgentCapabilities
} from "../src/main/agent-capabilities-client";

describe("Agent capabilities client", () => {
  it("derives HTTP base URL from caption websocket URL", () => {
    expect(agentHttpBaseUrlFromCaptionWsUrl("ws://127.0.0.1:8766/v1/caption/events")).toBe(
      "http://127.0.0.1:8766"
    );
    expect(agentHttpBaseUrlFromCaptionWsUrl("wss://agent.local/v1/caption/events")).toBe(
      "https://agent.local"
    );
  });

  it("fetches realtime capabilities from Agent", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ service: "echosync-agent" })
    });

    const capabilities = await fetchAgentCapabilities("http://127.0.0.1:8766", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:8766/v1/realtime/capabilities");
    expect(capabilities).toEqual({ service: "echosync-agent" });
  });

  it("throws readable error when Agent capabilities request fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable"
    });

    await expect(fetchAgentCapabilities("http://127.0.0.1:8766", fetchImpl)).rejects.toThrow(
      "Agent 能力检查失败"
    );
  });
});
