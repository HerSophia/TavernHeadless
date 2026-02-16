import { describe, it, expect } from 'vitest';
import { extractSummaries } from '../summary-extractor.js';

describe('extractSummaries', () => {
  describe('basic extraction', () => {
    it('extracts a single summary', () => {
      const text = 'Story content\n<summary>Alice met Bob</summary>\nMore content';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['Alice met Bob']);
      expect(result.cleanedText).toBe('Story content\n\nMore content');
    });

    it('extracts multiple summaries', () => {
      const text = '<summary>First</summary> middle <summary>Second</summary>';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['First', 'Second']);
      expect(result.cleanedText).toBe('middle');
    });

    it('returns original text when no summaries found', () => {
      const text = 'No summaries here';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual([]);
      expect(result.cleanedText).toBe('No summaries here');
    });
  });

  describe('different tag names', () => {
    it('extracts <memory> tags', () => {
      const text = 'Text <memory>Important fact</memory> more';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['Important fact']);
    });

    it('extracts <摘要> tags', () => {
      const text = 'Text <摘要>中文摘要内容</摘要> more';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['中文摘要内容']);
    });

    it('extracts <记忆> tags', () => {
      const text = 'Text <记忆>记忆内容</记忆> more';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['记忆内容']);
    });

    it('extracts <memo> tags', () => {
      const text = 'Text <memo>Memo content</memo> more';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['Memo content']);
    });

    it('extracts from multiple different tag types', () => {
      const text = '<summary>Sum</summary> <memory>Mem</memory>';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['Sum', 'Mem']);
    });
  });

  describe('custom tag names', () => {
    it('uses custom tag names', () => {
      const text = '<custom>Custom content</custom>';
      const result = extractSummaries(text, { tagNames: ['custom'] });

      expect(result.summaries).toEqual(['Custom content']);
    });

    it('ignores default tags when custom tags specified', () => {
      const text = '<summary>Default</summary> <custom>Custom</custom>';
      const result = extractSummaries(text, { tagNames: ['custom'] });

      expect(result.summaries).toEqual(['Custom']);
      // <summary> should remain in text
      expect(result.cleanedText).toContain('<summary>');
    });
  });

  describe('case insensitivity', () => {
    it('matches case-insensitively', () => {
      const text = '<Summary>Content</Summary>';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['Content']);
    });

    it('matches mixed case', () => {
      const text = '<SUMMARY>UPPER</SUMMARY>';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['UPPER']);
    });
  });

  describe('multiline content', () => {
    it('extracts multiline content', () => {
      const text = '<summary>\nLine 1\nLine 2\nLine 3\n</summary>';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual(['Line 1\nLine 2\nLine 3']);
    });
  });

  describe('keepInText option', () => {
    it('keeps tags in text when keepInText=true', () => {
      const text = 'Before <summary>Content</summary> After';
      const result = extractSummaries(text, { keepInText: true });

      expect(result.summaries).toEqual(['Content']);
      expect(result.cleanedText).toBe('Before <summary>Content</summary> After');
    });
  });

  describe('edge cases', () => {
    it('handles empty text', () => {
      const result = extractSummaries('');
      expect(result.summaries).toEqual([]);
      expect(result.cleanedText).toBe('');
    });

    it('handles empty tag content', () => {
      const text = '<summary></summary>';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual([]);
      expect(result.cleanedText).toBe('');
    });

    it('handles whitespace-only tag content', () => {
      const text = '<summary>   </summary>';
      const result = extractSummaries(text);

      expect(result.summaries).toEqual([]);
    });

    it('cleans up excessive blank lines', () => {
      const text = 'Before\n\n\n<summary>Content</summary>\n\n\nAfter';
      const result = extractSummaries(text);

      expect(result.cleanedText).toBe('Before\n\nAfter');
    });

    it('handles empty tagNames array', () => {
      const text = '<summary>Content</summary>';
      const result = extractSummaries(text, { tagNames: [] });

      expect(result.summaries).toEqual([]);
      expect(result.cleanedText).toBe(text);
    });
  });
});
