import { describe, it, expect } from 'vitest';
import { splitHashtags, titleFrom } from './chat';

describe('splitHashtags', () => {
  it('lifts a trailing hashtag line out of the body', () => {
    const { body, hashtags } = splitHashtags(
      'Our paper is out this week.\n\n#Neuroscience #SleepResearch',
    );
    expect(body).toBe('Our paper is out this week.');
    expect(hashtags).toEqual(['Neuroscience', 'SleepResearch']);
  });

  it('handles several trailing tag lines', () => {
    const { body, hashtags } = splitHashtags('Body text.\n\n#One #Two\n#Three');
    expect(body).toBe('Body text.');
    expect(hashtags).toEqual(['One', 'Two', 'Three']);
  });

  it('leaves hashtags that are part of a sentence alone', () => {
    const input = 'We presented at #NeurIPS last week and it went well.';
    const { body, hashtags } = splitHashtags(input);
    expect(body).toBe(input);
    expect(hashtags).toEqual([]);
  });

  it('keeps a body with no hashtags untouched', () => {
    const { body, hashtags } = splitHashtags('Just a plain post.');
    expect(body).toBe('Just a plain post.');
    expect(hashtags).toEqual([]);
  });

  it('deduplicates repeated tags', () => {
    const { hashtags } = splitHashtags('Text.\n\n#Open #Open #Science');
    expect(hashtags).toEqual(['Open', 'Science']);
  });

  it('does not swallow the whole post when it is only hashtags', () => {
    const { body, hashtags } = splitHashtags('#OnlyTags #Here');
    expect(body).toBe('');
    expect(hashtags).toEqual(['OnlyTags', 'Here']);
  });
});

describe('titleFrom', () => {
  it('uses the first sentence', () => {
    expect(titleFrom('Draft a post about sleep. Then shorten it.')).toBe(
      'Draft a post about sleep',
    );
  });

  it('falls back to the whole message when the first clause is tiny', () => {
    expect(titleFrom('Hi. Write me a post about protein folding')).toBe(
      'Hi. Write me a post about protein folding',
    );
  });

  it('truncates long messages on a word boundary', () => {
    const title = titleFrom('a'.repeat(200));
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('never returns an empty title', () => {
    expect(titleFrom('   ')).toBe('New chat');
  });
});
