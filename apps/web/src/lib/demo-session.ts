import type {
  CaptionLineModel,
  CaptionState,
  RealtimeEvent,
  SubtitleEvent,
  SubtitlePatchEvent
} from "@/lib/protocol";

export type WorkstationMode = "workstation" | "theater" | "reading" | "compact";
export type CaptureState = "idle" | "connecting" | "listening" | "recovering";
export type AudioSource = "mic" | "tab" | "file";

export type SessionMetric = {
  label: string;
  value: string;
  tone?: "good" | "warn" | "muted";
};

export type GlossaryTerm = {
  source: string;
  target: string;
  note: string;
};

export type NoteCard = {
  id: string;
  title: string;
  body: string;
  atMs: number;
};

export const modeLabels: Record<WorkstationMode, string> = {
  workstation: "工作台",
  theater: "剧场",
  reading: "阅读",
  compact: "悬浮"
};

export const modeDescriptions: Record<WorkstationMode, string> = {
  workstation: "三栏布局，适合技术分享和长会议。",
  theater: "大字幕舞台，适合直播和演讲。",
  reading: "句段回看，适合网课和录播复盘。",
  compact: "保留字幕核心，适合分屏和第二屏。"
};

export const glossaryTerms: GlossaryTerm[] = [
  {
    source: "vector database",
    target: "向量数据库",
    note: "技术语境中不要翻成矢量资料库。"
  },
  {
    source: "CUDA kernel",
    target: "CUDA 内核",
    note: "保留 CUDA，不做中文音译。"
  },
  {
    source: "retrieval augmented generation",
    target: "检索增强生成",
    note: "首次出现可保留 RAG 缩写。"
  }
];

export const noteCards: NoteCard[] = [
  {
    id: "note_1",
    title: "可复用结论",
    body: "讲者把向量索引和延迟预算放在一起解释，适合加入产品技术摘要。",
    atMs: 2200
  },
  {
    id: "note_2",
    title: "待确认术语",
    body: "LocalAgreement 后续需要在修正策略文档里补准确解释。",
    atMs: 7800
  }
];

export const sessionMetrics: SessionMetric[] = [
  { label: "首字幕", value: "640 ms", tone: "good" },
  { label: "稳定提交", value: "1.8 s", tone: "good" },
  { label: "补丁", value: "2 次", tone: "warn" },
  { label: "供应商", value: "级联模拟", tone: "muted" }
];

export const initialCaptionLines: CaptionLineModel[] = [
  {
    id: "seg_1",
    state: "locked",
    sourceText: "Today we will talk about vector databases.",
    targetText: "今天我们来谈谈向量数据库。",
    confidence: 0.96,
    startedAtMs: 0,
    endedAtMs: 2200,
    lockedAtMs: 2600,
    patches: []
  },
  {
    id: "seg_2",
    state: "stable",
    sourceText: "CUDA kernels make the pipeline faster.",
    targetText: "CUDA 内核让这条管道更快。",
    confidence: 0.88,
    startedAtMs: 2300,
    endedAtMs: 4300,
    patches: [
      {
        id: "patch_1",
        prev: "流程",
        next: "管道",
        startChar: 11,
        endChar: 13,
        atMs: 4100,
        reason: "terminology"
      }
    ]
  },
  {
    id: "seg_3",
    state: "interim",
    sourceText: "The retriever sends candidates into the generation step.",
    targetText: "检索器会把候选内容送入生成步骤。",
    confidence: 0.72,
    startedAtMs: 4400,
    endedAtMs: 6900,
    patches: []
  }
];

export const demoEvents: RealtimeEvent[] = [
  {
    type: "translation.partial",
    session_id: "sess_demo",
    segment_id: "seg_4",
    rev: 1,
    source_lang: "en",
    target_lang: "zh-CN",
    source_text: "Local agreement reduces flicker in live captions.",
    target_text: "局部一致性可以减少实时字幕闪烁。",
    status: "partial",
    stability: 0.68,
    start_ms: 7000,
    end_ms: 8500
  },
  {
    type: "translation.patch",
    session_id: "sess_demo",
    segment_id: "seg_4",
    rev: 2,
    base_rev: 1,
    target_lang: "zh-CN",
    operations: [
      {
        op: "replace",
        from_char: 0,
        to_char: 5,
        text: "LocalAgreement"
      }
    ],
    reason: "terminology",
    stability: 0.83
  },
  {
    type: "segment.commit",
    session_id: "sess_demo",
    segment_id: "seg_4",
    rev: 2,
    start_ms: 7000,
    end_ms: 8500,
    source_lang: "en",
    target_lang: "zh-CN",
    source_text: "Local agreement reduces flicker in live captions.",
    target_text: "LocalAgreement 可以减少实时字幕闪烁。",
    final: true
  }
];

export function applyRealtimeEvent(
  lines: CaptionLineModel[],
  event: RealtimeEvent,
  receivedAtMs: number
): CaptionLineModel[] {
  if (event.type === "translation.partial") {
    return upsertSubtitle(lines, event);
  }

  if (event.type === "translation.patch") {
    return applyPatch(lines, event, receivedAtMs);
  }

  if (event.type === "segment.commit") {
    return lines.map((line) =>
      line.id === event.segment_id
        ? {
            ...line,
            state: "locked",
            sourceText: event.source_text,
            targetText: event.target_text,
            endedAtMs: event.end_ms,
            lockedAtMs: receivedAtMs,
            confidence: 1
          }
        : line
    );
  }

  return lines;
}

function upsertSubtitle(lines: CaptionLineModel[], event: SubtitleEvent): CaptionLineModel[] {
  const state = mapSegmentStatus(event.status);
  const next: CaptionLineModel = {
    id: event.segment_id,
    state,
    sourceText: event.source_text,
    targetText: event.target_text,
    confidence: event.stability,
    startedAtMs: event.start_ms,
    endedAtMs: event.end_ms,
    patches: lines.find((line) => line.id === event.segment_id)?.patches ?? []
  };

  if (lines.some((line) => line.id === event.segment_id)) {
    return lines.map((line) => (line.id === event.segment_id ? next : line));
  }

  return [...lines, next];
}

function applyPatch(
  lines: CaptionLineModel[],
  event: SubtitlePatchEvent,
  receivedAtMs: number
): CaptionLineModel[] {
  return lines.map((line) => {
    if (line.id !== event.segment_id) {
      return line;
    }

    const targetText = event.operations.reduce((text, operation) => {
      if (operation.op === "replace") {
        return `${text.slice(0, operation.from_char)}${operation.text}${text.slice(operation.to_char)}`;
      }
      if (operation.op === "insert") {
        return `${text.slice(0, operation.at_char)}${operation.text}${text.slice(operation.at_char)}`;
      }
      return `${text.slice(0, operation.from_char)}${text.slice(operation.to_char)}`;
    }, line.targetText);

    const patches = event.operations.map((operation, index) => {
      const startChar = operation.op === "insert" ? operation.at_char : operation.from_char;
      const endChar = operation.op === "insert" ? operation.at_char : operation.to_char;
      const prev = operation.op === "insert" ? "" : line.targetText.slice(startChar, endChar);
      return {
        id: `${event.segment_id}_${event.rev}_${index}`,
        prev,
        next: operation.op === "delete" ? "" : operation.text,
        startChar,
        endChar,
        atMs: receivedAtMs,
        reason: event.reason
      };
    });

    return {
      ...line,
      state: "revised" satisfies CaptionState,
      targetText,
      confidence: event.stability,
      patches: [...line.patches, ...patches]
    };
  });
}

function mapSegmentStatus(status: SubtitleEvent["status"]): CaptionState {
  if (status === "committed") {
    return "locked";
  }
  if (status === "stable") {
    return "stable";
  }
  return "interim";
}
