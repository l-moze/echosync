import type { AgentCapabilities } from "../shared/agent-capabilities";

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

type FetchAgentCapabilitiesOptions = {
  attempts?: number;
  retryDelayMs?: number;
};

const DEFAULT_CAPABILITIES_ATTEMPTS = 3;
const DEFAULT_CAPABILITIES_RETRY_DELAY_MS = 250;

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
  fetchImpl: FetchLike = fetch,
  options: FetchAgentCapabilitiesOptions = {}
): Promise<AgentCapabilities> {
  const endpoint = `${agentHttpBaseUrl}/v1/realtime/capabilities`;
  const attempts = Math.max(1, options.attempts ?? DEFAULT_CAPABILITIES_ATTEMPTS);
  const retryDelayMs = Math.max(
    0,
    options.retryDelayMs ?? DEFAULT_CAPABILITIES_RETRY_DELAY_MS
  );
  let lastNetworkError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(endpoint);
      if (!response.ok) {
        throw new Error(`Agent 能力检查失败：${response.status} ${response.statusText}`);
      }
      return (await response.json()) as AgentCapabilities;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Agent 能力检查失败")) {
        throw error;
      }
      lastNetworkError = error;
      if (attempt < attempts) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw new Error(
    `无法连接同传 Agent（${agentHttpBaseUrl}）。请确认已启动 python -m echosync_agent.transport.caption_ws 并监听 8766。${networkErrorDetail(lastNetworkError)}`
  );
}

function networkErrorDetail(error: unknown) {
  if (error instanceof Error && error.message) {
    return `底层错误：${error.message}`;
  }
  return "";
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
