/**
 * Unit tests for caption-text-view.ts
 *
 * Critical functions tested:
 * - isLikelyStreamingRevision: Detects legitimate text revisions vs unrelated new content
 */

import { describe, it, expect } from 'vitest';

// Import the module - we'll need to expose the function for testing
// For now, we'll test through the public API
import {
  selectCaptionTextBlocks,
  selectBufferedCaptionTextBlocks,
  createInitialCaptionTextBlockBuffer
} from './caption-text-view';
import type { CaptionLine } from './caption-store';
import { defaultSubtitleStyle, type SubtitleStyleState } from './subtitle-style-state';

const sentencePairStyle: SubtitleStyleState = {
  ...defaultSubtitleStyle,
  displayMode: 'sentencePair'
};

const zonedPairStyle: SubtitleStyleState = {
  ...defaultSubtitleStyle,
  displayMode: 'zonedPair'
};

// Helper to create a mock CaptionLine
function createMockLine(id: string, sourceText: string, targetText: string = '', state: 'interim' | 'stable' = 'interim'): CaptionLine {
  return {
    id,
    rev: 1,
    sourceText,
    targetText,
    state,
    stability: state === 'stable' ? 0.9 : 0.5,
    startMs: 0,
    endMs: 1000,
    patchCount: 0
  };
}

describe('caption-text-view', () => {
  describe('selectCaptionTextBlocks', () => {
    const subtitleStyle = sentencePairStyle;

    it('should show placeholder when line is undefined', () => {
      const blocks = selectCaptionTextBlocks(undefined, subtitleStyle);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].sourceText).toBe('等待音频输入...');
      expect(blocks[0].state).toBe('interim');
    });

    it('should display source and target text for short content', () => {
      const line = createMockLine('line1', 'Hello world', '你好世界');
      const blocks = selectCaptionTextBlocks(line, subtitleStyle);

      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0].sourceText).toContain('Hello world');
    });

    it('should split long text into multiple blocks', () => {
      const longText = 'This is a very long sentence. It contains multiple parts. And it should be split into separate blocks for better readability. Each block represents a natural breaking point in the text.';
      const line = createMockLine('line1', longText);
      const blocks = selectCaptionTextBlocks(line, subtitleStyle);

      // Long text should be split
      expect(blocks.length).toBeGreaterThan(1);
    });
  });

  describe('selectBufferedCaptionTextBlocks - text revision detection', () => {
    const subtitleStyle = sentencePairStyle;
    const nowMs = Date.now();

    it('should handle text extension (common case)', () => {
      const buffer = createInitialCaptionTextBlockBuffer();

      // First update
      const line1 = createMockLine('seg1', 'The quick');
      const result1 = selectBufferedCaptionTextBlocks(buffer, line1, subtitleStyle, nowMs);

      // Extension
      const line2 = createMockLine('seg1', 'The quick brown fox');
      const result2 = selectBufferedCaptionTextBlocks(result1.buffer, line2, subtitleStyle, nowMs);

      expect(result2.blocks[0].sourceText).toContain('quick brown fox');
    });

    it('should handle complete text replacement', () => {
      const buffer = createInitialCaptionTextBlockBuffer();

      const line1 = createMockLine('seg1', 'Old content that will be replaced');
      const result1 = selectBufferedCaptionTextBlocks(buffer, line1, subtitleStyle, nowMs);

      const line2 = createMockLine('seg1', 'Completely new content');
      const result2 = selectBufferedCaptionTextBlocks(result1.buffer, line2, subtitleStyle, nowMs);

      expect(result2.blocks[0].sourceText).toContain('new content');
    });

    it('should preserve committed breaks when text is revised', () => {
      const buffer = createInitialCaptionTextBlockBuffer();

      // Start with long text that triggers breaking
      const longText = 'This is a very long sentence that will definitely trigger text breaking. It contains multiple sentences. And we want to ensure that breaks are preserved correctly when the text is revised later.';
      const line1 = createMockLine('seg1', longText);
      const result1 = selectBufferedCaptionTextBlocks(buffer, line1, subtitleStyle, nowMs + 2000);

      // Slight revision
      const revisedText = longText + ' Additional content appended.';
      const line2 = createMockLine('seg1', revisedText);
      const result2 = selectBufferedCaptionTextBlocks(result1.buffer, line2, subtitleStyle, nowMs + 3000);

      // Should maintain multiple blocks
      expect(result2.blocks.length).toBeGreaterThanOrEqual(result1.blocks.length);
    });
  });

  describe('text breaking behavior', () => {
    const subtitleStyle = sentencePairStyle;

    it('should not break short sentences immediately', () => {
      const shortText = 'Hello. World.';
      const line = createMockLine('seg1', shortText);
      const blocks = selectCaptionTextBlocks(line, subtitleStyle);

      // Short text should stay as one block
      expect(blocks).toHaveLength(1);
    });

    it('should break at natural boundaries for long text', () => {
      const longText = 'This is the first sentence. This is the second sentence. This is the third sentence. And this continues with more content that needs to be displayed properly without causing visual issues.';
      const line = createMockLine('seg1', longText);
      const blocks = selectCaptionTextBlocks(line, subtitleStyle);

      // Should break at sentence boundaries
      expect(blocks.length).toBeGreaterThan(1);

      // First block should contain first sentence
      expect(blocks[0].sourceText).toMatch(/first sentence/);
    });
  });

  describe('zonedPair display mode', () => {
    const subtitleStyle = zonedPairStyle;

    it('should not split text in zonedPair mode', () => {
      const longText = 'This is a very long sentence. It contains multiple parts. And it should NOT be split in zonedPair mode.';
      const line = createMockLine('seg1', longText);
      const blocks = selectCaptionTextBlocks(line, subtitleStyle);

      // zonedPair should keep everything in one block
      expect(blocks).toHaveLength(1);
      expect(blocks[0].sourceText).toBe(longText);
    });
  });

  describe('edge cases', () => {
    const subtitleStyle = sentencePairStyle;

    it('should handle empty source text', () => {
      const line = createMockLine('seg1', '', '翻译文本');
      const blocks = selectCaptionTextBlocks(line, subtitleStyle);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].isSourcePlaceholder).toBe(true);
    });

    it('should handle whitespace-only text', () => {
      const line = createMockLine('seg1', '   ', '');
      const blocks = selectCaptionTextBlocks(line, subtitleStyle);

      // Whitespace is trimmed
      expect(blocks[0].sourceText).toBe('等待音频输入...');
    });

    it('should handle text with only punctuation', () => {
      const line = createMockLine('seg1', '...', '');
      const blocks = selectCaptionTextBlocks(line, subtitleStyle);

      expect(blocks).toHaveLength(1);
      expect(blocks[0].sourceText).toBe('...');
    });
  });
});
