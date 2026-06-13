/**
 * Unit tests for caption-store.ts
 *
 * Critical functions tested:
 * - applyRealtimeEvent: Handles transcript.partial and caption_update events
 * - Text truncation protection: Preserves historical text when new text is suspiciously shorter
 * - selectActiveCaptionLine: Active caption line selection logic
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyRealtimeEvent,
  selectActiveCaptionLine,
  type CaptionLine
} from './caption-store';
import type { CaptionUpdateState, RealtimeEvent, SegmentStatus } from './realtime-events';

function transcriptEvent({
  rev = 1,
  segmentId = 'seg1',
  status = 'partial',
  text
}: {
  rev?: number;
  segmentId?: string;
  status?: SegmentStatus;
  text: string;
}): RealtimeEvent {
  return {
    type: 'transcript.partial',
    session_id: 'test-session',
    segment_id: segmentId,
    rev,
    source_lang: 'en',
    target_lang: 'zh',
    source_text: text,
    target_text: '',
    status,
    stability: status === 'partial' ? 0.5 : 0.9,
    start_ms: 0,
    end_ms: 1000
  };
}

function captionUpdateEvent({
  segmentId = 'seg1',
  sourceText,
  state = 'final',
  targetText
}: {
  segmentId?: string;
  sourceText: string;
  state?: CaptionUpdateState;
  targetText: string;
}): RealtimeEvent {
  return {
    type: 'caption_update',
    session_id: 'test-session',
    segment_id: segmentId,
    revision: 2,
    source: {
      full_text: sourceText,
      language: 'en',
      stable_text: sourceText,
      unstable_text: ''
    },
    target: {
      full_text: targetText,
      language: 'zh',
      stable_text: targetText,
      unstable_text: ''
    },
    state,
    timing: {
      start_ms: 0,
      end_ms: 1000
    }
  };
}

describe('caption-store', () => {
  let lines: CaptionLine[];

  beforeEach(() => {
    lines = [];
  });

  describe('text truncation protection - transcript.partial', () => {
    it('should accept text extension', () => {
      // First event: short text
      const event1 = transcriptEvent({ text: 'The quick' });
      lines = applyRealtimeEvent(lines, event1);

      // Second event: extended text
      const event2 = transcriptEvent({ text: 'The quick brown fox', rev: 2 });
      lines = applyRealtimeEvent(lines, event2);

      const activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.sourceText).toBe('The quick brown fox');
    });

    it('should preserve historical text when new text is significantly shorter', () => {
      // First event: long text (PARTIAL state)
      const longText = 'This is a complete sentence with many words that provides full context and information';
      const event1 = transcriptEvent({ text: longText });
      lines = applyRealtimeEvent(lines, event1);

      // Second event: truncated text (simulating ASR COMMITTED state bug)
      const truncatedText = 'This is a complete sentence';
      const event2 = transcriptEvent({ text: truncatedText, rev: 2, status: 'committed' });
      lines = applyRealtimeEvent(lines, event2);

      // Should preserve the longer historical text
      const activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.sourceText).toBe(longText);
      expect(activeLine?.sourceText.length).toBeGreaterThan(truncatedText.length);
    });

    it('should allow minor text corrections (≤8 chars shrinkage)', () => {
      const event1 = transcriptEvent({ text: 'Hello wrld test' });
      lines = applyRealtimeEvent(lines, event1);

      // Minor correction: fixed typo, slightly shorter
      const event2 = transcriptEvent({ text: 'Hello world', rev: 2, status: 'committed' });
      lines = applyRealtimeEvent(lines, event2);

      const activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.sourceText).toBe('Hello world');
    });

    it('should handle empty text transition', () => {
      const event1 = transcriptEvent({ text: 'Some text' });
      lines = applyRealtimeEvent(lines, event1);

      const event2 = transcriptEvent({ text: '', rev: 2, status: 'committed' });
      lines = applyRealtimeEvent(lines, event2);

      // Empty committed text is treated as suspicious shrinkage and should not erase visible history.
      const activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.sourceText).toBe('Some text');
    });
  });

  describe('text truncation protection - caption_update', () => {
    it('should preserve text when caption_update contains truncated text', () => {
      // First establish a line with full text via transcript.partial
      const event1 = transcriptEvent({ text: 'This is the complete sentence with full context' });
      lines = applyRealtimeEvent(lines, event1);

      // caption_update with truncated source (the bug we fixed)
      const event2 = captionUpdateEvent({
        sourceText: 'This is the complete',
        targetText: '这是完整的句子'
      });
      lines = applyRealtimeEvent(lines, event2);

      // Should preserve the longer historical text
      const activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.sourceText).toBe('This is the complete sentence with full context');
    });

    it('should accept caption_update when text is extended', () => {
      const event1 = transcriptEvent({ text: 'Short text' });
      lines = applyRealtimeEvent(lines, event1);

      const event2 = captionUpdateEvent({
        sourceText: 'Short text with more content added',
        targetText: '简短文本增加了更多内容'
      });
      lines = applyRealtimeEvent(lines, event2);

      const activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.sourceText).toBe('Short text with more content added');
    });

    it('should update translation even when source is protected', () => {
      // Establish baseline
      const event1 = transcriptEvent({ text: 'This is a very long sentence with complete information' });
      lines = applyRealtimeEvent(lines, event1);

      // caption_update with truncated source but valid translation
      const event2 = captionUpdateEvent({
        sourceText: 'This is a very',
        targetText: '这是一个非常完整的翻译'
      });
      lines = applyRealtimeEvent(lines, event2);

      const activeLine = selectActiveCaptionLine(lines);
      // Source should be protected
      expect(activeLine?.sourceText).toBe('This is a very long sentence with complete information');
      // But translation should be updated
      expect(activeLine?.targetText).toBe('这是一个非常完整的翻译');
    });
  });

  describe('selectActiveCaptionLine', () => {
    it('should return undefined when no lines exist', () => {
      const activeLine = selectActiveCaptionLine(lines);
      expect(activeLine).toBeUndefined();
    });

    it('should return the most recent line', () => {
      const event1 = transcriptEvent({ text: 'First line' });
      lines = applyRealtimeEvent(lines, event1);

      const event2 = transcriptEvent({ text: 'Second line', segmentId: 'seg2' });
      lines = applyRealtimeEvent(lines, event2);

      const activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.id).toBe('seg2');
      expect(activeLine?.sourceText).toBe('Second line');
    });

    it('should handle state transitions correctly', () => {
      const event1 = transcriptEvent({ text: 'Test line' });
      lines = applyRealtimeEvent(lines, event1);

      let activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.state).toBe('interim');

      const event2 = captionUpdateEvent({
        sourceText: 'Test line',
        targetText: '测试行'
      });
      lines = applyRealtimeEvent(lines, event2);

      activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.state).toBe('locked');
    });
  });

  describe('edge cases', () => {
    it('should handle rapid successive updates', () => {
      const baseText = 'The quick brown fox';

      for (let i = 0; i < 10; i++) {
        const event = transcriptEvent({ text: baseText + ' '.repeat(i), rev: i + 1 });
        lines = applyRealtimeEvent(lines, event);
      }

      const activeLine = selectActiveCaptionLine(lines);
      expect(activeLine?.sourceText).toContain(baseText);
    });

    it('should handle multiple segments correctly', () => {
      const event1 = transcriptEvent({ text: 'First segment', status: 'committed' });
      lines = applyRealtimeEvent(lines, event1);

      const event2 = transcriptEvent({ text: 'Second segment', segmentId: 'seg2' });
      lines = applyRealtimeEvent(lines, event2);

      expect(lines).toHaveLength(2);
      expect(lines[0].id).toBe('seg1');
      expect(lines[1].id).toBe('seg2');
    });

    it('should handle whitespace correctly', () => {
      const event = transcriptEvent({ text: '   Hello   World   ' });
      lines = applyRealtimeEvent(lines, event);

      const activeLine = selectActiveCaptionLine(lines);
      // The store preserves protocol text as received; trimming belongs in producers or view formatting.
      expect(activeLine?.sourceText).toBe('   Hello   World   ');
    });
  });
});
