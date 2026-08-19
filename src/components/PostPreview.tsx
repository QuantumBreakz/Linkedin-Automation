/**
 * What the post will actually look like on LinkedIn.
 *
 * The point of this component is that it is not a summary or an approximation
 * — it renders the exact text that `publishDraft()` will send, hashtags
 * appended the same way, image attached the same way. Somebody clicking
 * "Approve & publish" should never see something different afterwards on
 * their feed.
 */

import { Avatar } from '@/components/ui';

/** Mirrors the assembly in services/linkedin/publish.ts. Keep the two in step. */
export function composePostText(body: string, hashtags: string[]): string {
  const tags = hashtags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
  return tags.length > 0 ? `${body}\n\n${tags.join(' ')}` : body;
}

/** LinkedIn collapses a post past roughly this many characters behind "…see more". */
const FOLD = 210;

export function PostPreview({
  body,
  hashtags,
  authorName,
  authorHeadline,
  authorAvatar,
  imageUrl,
  imageAlt,
  images,
  linkUrl,
}: {
  body: string;
  hashtags: string[];
  authorName: string;
  authorHeadline?: string | null;
  authorAvatar?: string | null;
  imageUrl?: string | null;
  imageAlt?: string | null;
  images?: Array<{ id: string; url: string; altText: string }>;
  linkUrl?: string | null;
}) {
  const text = composePostText(body, hashtags);
  const folded = text.length > FOLD;

  const displayImages = images && images.length > 0
    ? images
    : imageUrl
      ? [{ id: 'single', url: imageUrl, altText: imageAlt ?? '' }]
      : [];

  return (
    <div className="overflow-hidden rounded-3xl border border-ink-900/10 bg-white">
      <div className="flex items-center gap-3 px-5 pt-5">
        <Avatar name={authorName} src={authorAvatar} size={44} tone="ink" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-900">{authorName}</p>
          <p className="truncate text-xs text-ink-500">{authorHeadline || 'Researcher'}</p>
          <p className="text-[0.65rem] text-ink-500">Now · 🌐 Anyone</p>
        </div>
      </div>

      <p className="whitespace-pre-wrap px-5 py-4 text-sm leading-relaxed text-ink-800">
        {text.slice(0, FOLD)}
        {folded && (
          <>
            <span className="text-ink-500">{text.slice(FOLD)}</span>
          </>
        )}
      </p>

      {folded && (
        <p className="-mt-2 px-5 pb-2 text-[0.7rem] text-ink-500">
          Grey text sits below LinkedIn&apos;s “…see more” fold.
        </p>
      )}

      {displayImages.length === 1 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={displayImages[0].url}
          alt={displayImages[0].altText || ''}
          className="w-full border-y border-ink-900/8 max-h-[30rem] object-cover"
        />
      )}

      {displayImages.length === 2 && (
        <div className="grid grid-cols-2 gap-1 border-y border-ink-900/8 bg-ink-900/5">
          {displayImages.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={img.id}
              src={img.url}
              alt={img.altText || ''}
              className="h-60 w-full object-cover"
            />
          ))}
        </div>
      )}

      {displayImages.length >= 3 && (
        <div className="grid grid-cols-2 gap-1 border-y border-ink-900/8 bg-ink-900/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displayImages[0].url}
            alt={displayImages[0].altText || ''}
            className="row-span-2 h-full w-full object-cover max-h-80"
          />
          <div className="grid gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayImages[1].url}
              alt={displayImages[1].altText || ''}
              className="h-36 w-full object-cover"
            />
            <div className="relative h-36 w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={displayImages[2].url}
                alt={displayImages[2].altText || ''}
                className="h-full w-full object-cover"
              />
              {displayImages.length > 3 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-lg font-bold text-white">
                  +{displayImages.length - 3}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {linkUrl && displayImages.length === 0 && (
        <div className="mx-5 mb-4 rounded-2xl border border-ink-900/10 bg-cream-100 px-4 py-3">
          <p className="truncate text-xs font-medium text-ink-700">{linkUrl}</p>
          <p className="text-[0.65rem] text-ink-500">Link preview, as rendered by LinkedIn</p>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-ink-900/8 px-5 py-3 text-[0.7rem] font-medium text-ink-500">
        <span>Like · Comment · Repost · Send</span>
        <span>{text.length.toLocaleString()} / 3,000</span>
      </div>
    </div>
  );
}
