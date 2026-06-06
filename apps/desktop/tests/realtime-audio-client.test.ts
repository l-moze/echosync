import { afterEach, describe, expect, it, vi } from "vitest";

import { createRealtimeAudioClient } from "../src/renderer/realtime-audio-client";
import { AUDIO_FRAME_HEADER_BYTES, AUDIO_FRAME_MAGIC } from "../src/renderer/pcm-audio";

describe("renderer realtime audio client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not open the realtime socket when display media capture fails", async () => {
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockRejectedValue(new Error("permission denied"))
      }
    });

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_test",
      sourceId: "windows-system"
    });

    await expect(client.start()).rejects.toThrow("permission denied");
    expect(sockets).toHaveLength(0);
  });

  it("requests display media with video track for Windows loopback capture", async () => {
    const getDisplayMedia = vi.fn().mockRejectedValue(new Error("stop after constraints"));
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia
      }
    });

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_constraints",
      sourceId: "windows-system"
    });

    await expect(client.start()).rejects.toThrow("stop after constraints");

    expect(getDisplayMedia).toHaveBeenCalledWith({
      audio: true,
      video: true
    });
  });

  it("requests microphone media with getUserMedia", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("stop after constraints"));
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia
      }
    });

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_microphone",
      sourceId: "microphone"
    });

    await expect(client.start()).rejects.toThrow("stop after constraints");

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: true,
      video: false
    });
  });

  it("stops Electron's placeholder video tracks before streaming audio to Agent", async () => {
    const videoTrack = { stop: vi.fn() };
    const audioTrack = { stop: vi.fn() };
    const stream = {
      getVideoTracks: () => [videoTrack],
      getTracks: () => [audioTrack, videoTrack]
    };
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_video",
      sourceId: "windows-system"
    });

    await client.start();

    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(sockets[0]?.sentMessages[0]).toContain('"type":"audio.start"');
    await client.stop();
  });

  it("marks audio.end as user_stop when the desktop client is stopped explicitly", async () => {
    const stream = {
      getVideoTracks: () => [],
      getTracks: () => []
    };
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_stop_reason",
      sourceId: "windows-system"
    });

    await client.start();
    await client.stop();

    const lastMessage = sockets[0]?.sentMessages.at(-1);
    expect(typeof lastMessage).toBe("string");
    expect(JSON.parse(lastMessage as string)).toEqual({
      type: "audio.end",
      reason: "user_stop"
    });
  });

  it("records the original media stream and returns the recording when stopped", async () => {
    const stream = createFakeMediaStream();
    const recorder = {
      startedStream: null as MediaStream | null,
      start: vi.fn((nextStream: MediaStream) => {
        recorder.startedStream = nextStream;
      }),
      stop: vi.fn().mockResolvedValue({
        blob: new Blob(["audio"], { type: "audio/webm" }),
        mimeType: "audio/webm"
      }),
      discard: vi.fn()
    };
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      recorder,
      sessionId: "sess_recording",
      sourceId: "windows-system"
    });

    await client.start();
    const recording = await client.stop();

    expect(recorder.startedStream).toBe(stream);
    expect(recording?.mimeType).toBe("audio/webm");
  });

  it("declares the binary PCM protocol when starting a realtime session", async () => {
    const stream = createFakeMediaStream();
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_binary_start",
      sourceId: "windows-system"
    });

    await client.start();

    expect(JSON.parse(sockets[0]?.sentMessages[0] as string)).toMatchObject({
      type: "audio.start",
      protocol: "pcm16.binary.v1",
      frame_duration_ms: 80
    });
    await client.stop();
  });

  it("does not override the server default ASR provider unless user selected one", async () => {
    const stream = createFakeMediaStream();
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_default_provider",
      sourceId: "windows-system"
    });

    await client.start();

    expect(JSON.parse(sockets[0]?.sentMessages[0] as string)).not.toHaveProperty("asr_provider");
    await client.stop();
  });

  it("declares the selected ASR provider and latency mode when starting a realtime session", async () => {
    const stream = createFakeMediaStream();
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const client = createRealtimeAudioClient({
      asrLatencyMode: "accuracy",
      asrProvider: "voxtral",
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_asr_provider",
      sourceId: "windows-system"
    });

    await client.start();

    expect(JSON.parse(sockets[0]?.sentMessages[0] as string)).toMatchObject({
      asr_latency_mode: "accuracy",
      asr_provider: "voxtral",
      type: "audio.start"
    });
    await client.stop();
  });

  it("declares the selected translation provider when starting a realtime session", async () => {
    const stream = createFakeMediaStream();
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_translation_provider",
      sourceId: "windows-system",
      translationProvider: "deepseek"
    });

    await client.start();

    expect(JSON.parse(sockets[0]?.sentMessages[0] as string)).toMatchObject({
      translation_provider: "deepseek",
      type: "audio.start"
    });
    await client.stop();
  });

  it("sends encoded audio as binary websocket frames", async () => {
    const audioContext = new FakeAudioContext();
    FakeAudioContext.nextInstance = audioContext;
    const stream = createFakeMediaStream();
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("performance", {
      now: () => 456,
      timeOrigin: 123000
    });

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_binary_audio",
      sourceId: "windows-system"
    });

    await client.start();
    audioContext.emitAudioProcess(new Float32Array(7680).fill(0.25));

    const frame = sockets[0]?.sentMessages.find((message) => message instanceof ArrayBuffer);
    expect(frame).toBeInstanceOf(ArrayBuffer);
    const view = new DataView(frame as ArrayBuffer);
    expect(view.getUint32(0, true)).toBe(AUDIO_FRAME_MAGIC);
    expect((frame as ArrayBuffer).byteLength).toBe(AUDIO_FRAME_HEADER_BYTES + 2560);
    expect(view.getUint32(20, true)).toBe(123456);
    await client.stop();
  });

  it("sends audio final as a control message after gate silence", async () => {
    const audioContext = new FakeAudioContext();
    FakeAudioContext.nextInstance = audioContext;
    const stream = createFakeMediaStream();
    const sockets: FakeWebSocket[] = [];
    vi.stubGlobal("WebSocket", class extends FakeWebSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getDisplayMedia: vi.fn().mockResolvedValue(stream)
      }
    });
    vi.stubGlobal("window", {
      AudioContext: FakeAudioContext,
      webkitAudioContext: undefined
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);

    const client = createRealtimeAudioClient({
      endpointBaseUrl: "ws://agent/realtime",
      sessionId: "sess_audio_final",
      sourceId: "windows-system"
    });

    await client.start();
    audioContext.emitAudioProcess(new Float32Array(11_520).fill(0.25));

    const binaryFramesBeforeSilence = sockets[0]?.sentMessages.filter(
      (message) => message instanceof ArrayBuffer
    );
    expect(binaryFramesBeforeSilence).toHaveLength(3);
    expect(
      binaryFramesBeforeSilence?.every(
        (message) => new DataView(message as ArrayBuffer).getUint16(6, true) === 0
      )
    ).toBe(true);

    audioContext.emitAudioProcess(new Float32Array(30_720));

    const finalMessage = sockets[0]?.sentMessages
      .filter((message): message is string => typeof message === "string")
      .map((message) => JSON.parse(message))
      .find((message) => message.type === "audio.final");
    expect(finalMessage).toMatchObject({
      end_ms: 240,
      seq: 3,
      start_ms: 240,
      type: "audio.final"
    });
    await client.stop();
  });
});

class FakeWebSocket {
  static OPEN = 1;

  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  closed = false;
  sentMessages: Array<string | ArrayBuffer> = [];
  private listeners = new Map<string, Array<() => void>>();

  constructor(url: string) {
    this.url = url;
    queueMicrotask(() => this.emit("open"));
  }

  addEventListener(type: string, listener: () => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send(message: string | ArrayBuffer) {
    this.sentMessages.push(message);
    return undefined;
  }

  close() {
    this.closed = true;
  }

  private emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

class FakeAudioContext {
  static nextInstance: FakeAudioContext | null = null;

  sampleRate = 48000;
  state = "running";
  destination = {};
  processor: FakeScriptProcessorNode | null = null;

  constructor() {
    const next = FakeAudioContext.nextInstance;
    if (next) {
      FakeAudioContext.nextInstance = null;
      return next;
    }
  }

  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }

  createScriptProcessor() {
    this.processor = new FakeScriptProcessorNode();
    return this.processor;
  }

  createGain() {
    return { connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } };
  }

  close() {
    this.state = "closed";
    return Promise.resolve();
  }

  emitAudioProcess(samples: Float32Array) {
    this.processor?.emit(samples);
  }
}

class FakeScriptProcessorNode {
  connect = vi.fn();
  disconnect = vi.fn();
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;

  emit(samples: Float32Array) {
    this.onaudioprocess?.({
      inputBuffer: {
        getChannelData: () => samples,
        numberOfChannels: 1
      }
    } as unknown as AudioProcessingEvent);
  }
}

function createFakeMediaStream() {
  const videoTrack = { stop: vi.fn() };
  const audioTrack = { stop: vi.fn() };
  return {
    getVideoTracks: () => [videoTrack],
    getTracks: () => [audioTrack, videoTrack]
  };
}
