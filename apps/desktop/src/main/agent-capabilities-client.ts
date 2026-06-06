import type { AgentCapabilities } from "../shared/agent-capabilities";

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

export function agentHttpBaseUrlFromCaptionWsUrl(captionWsUrl: string): string {
  const url = new URL(captionWsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function fetchAgentCapabilities(
  agentHttpBaseUrl: string,
  fetchImpl: FetchLike = fetch
): Promise<AgentCapabilities> {
  const response = await fetchImpl(`${agentHttpBaseUrl}/v1/realtime/capabilities`);
  if (!response.ok) {
    throw new Error(`Agent 能力检查失败：${response.status} ${response.statusText}`);
  }
  return (await response.json()) as AgentCapabilities;
}
