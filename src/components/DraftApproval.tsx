'use client';

/**
 * The approval screen for one draft.
 *
 * The flow it enforces: **see it, then approve it, then it posts.** Preview is
 * the default view and shows the exact composed text; the Approve button is
 * the only path to `POST /api/drafts/:id/approve`, which is in turn the only
 * caller of the publisher besides the scheduled-job worker.
 *
 * Edits made here are sent with the approval in the same request, so what was
 * on screen when the button was pressed is what gets posted — there is no
 * window where a stale body could go out.
 */

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PostPreview, composePostText } from '@/components/PostPreview';
import { Badge, statusTone, humanise } from '@/components/ui';

export interface ImageItemView {
  id: string;
  url: string;
  altText: string;
  isPrimary?: boolean;
}

export interface DraftView {
  id: string;
  status: string;
  format: string;
  origin: string;
  body: string;
  hashtags: string[];
  linkUrl: string | null;
  verificationStatus: string;
  scheduledFor: string | null;
  paperTitle: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  images?: ImageItemView[];
  permalink: string | null;
}

type Notice = { tone: 'ok' | 'error'; text: string } | null;

const MAX_LENGTH = 3000;
const MAX_IMAGES = 10;

export function DraftApproval({
  draft,
  authorName,
  authorHeadline,
  authorAvatar,
  linkedinConnected,
  dryRun,
}: {
  draft: DraftView;
  authorName: string;
  authorHeadline: string | null;
  authorAvatar: string | null;
  linkedinConnected: boolean;
  /** LINKEDIN_DRY_RUN — publishing is simulated, nothing leaves the machine. */
  dryRun: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [body, setBody] = useState(draft.body);
  const [hashtagText, setHashtagText] = useState(draft.hashtags.join(' '));
  const [images, setImages] = useState<ImageItemView[]>(
    draft.images && draft.images.length > 0
      ? draft.images
      : draft.imageUrl
        ? [{ id: 'primary', url: draft.imageUrl, altText: draft.imageAlt || 'Attached picture' }]
        : [],
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'approve' | 'publish' | 'schedule' | 'reject' | 'delete' | 'upload_image' | 'delete_image'>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [status, setStatus] = useState(draft.status);
  const [scheduleAt, setScheduleAt] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const hashtags = hashtagText
    .split(/[\s,]+/)
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter(Boolean);

  const composedLength = composePostText(body, hashtags).length;
  const tooLong = composedLength > MAX_LENGTH;
  const isPublished = status === 'PUBLISHED';
  const isCancelled = status === 'CANCELLED';
  const dirty = body !== draft.body || hashtags.join(' ') !== draft.hashtags.join(' ');

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (images.length + files.length > MAX_IMAGES) {
      setNotice({
        tone: 'error',
        text: `You can only attach up to ${MAX_IMAGES} pictures per post. Currently have ${images.length}.`,
      });
      return;
    }

    setBusy('upload_image');
    setNotice(null);

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('file', files[i]);
    }

    try {
      const res = await fetch(`/api/drafts/${draft.id}/image`, {
        method: 'POST',
        body: formData,
      });

      const data = (await res.json().catch(() => ({}))) as {
        images?: ImageItemView[];
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error ?? 'Upload failed');
      }

      if (data.images) {
        setImages(data.images);
        setNotice({
          tone: 'ok',
          text: `Added ${files.length} picture${files.length > 1 ? 's' : ''} to draft (${data.images.length}/${MAX_IMAGES}).`,
        });
        router.refresh();
      }
    } catch (err) {
      setNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Could not upload image.',
      });
    } finally {
      setBusy(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleRemoveImage(visualId?: string) {
    setBusy('delete_image');
    setNotice(null);

    try {
      const res = await fetch(`/api/drafts/${draft.id}/image`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visualId }),
      });
      const data = (await res.json().catch(() => ({}))) as { images?: ImageItemView[] };
      if (!res.ok) throw new Error();

      setImages(data.images ?? []);
      setNotice({ tone: 'ok', text: visualId ? 'Picture removed.' : 'All pictures removed.' });
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Could not remove image.' });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setNotice(null);
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, hashtags }),
      });
      if (!res.ok) throw new Error();
      setNotice({ tone: 'ok', text: 'Saved.' });
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Could not save those changes.' });
    } finally {
      setBusy(null);
    }
  }

  async function approve(mode: 'approve' | 'publish' | 'schedule') {
    setBusy(mode);
    setNotice(null);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          body,
          hashtags,
          ...(mode === 'schedule' && scheduleAt
            ? { scheduledFor: new Date(scheduleAt).toISOString() }
            : {}),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        setNotice({ tone: 'error', text: data.error ?? 'That did not go through.' });
        if (data.status) setStatus(data.status);
        router.refresh();
        return;
      }

      if (data.status) setStatus(data.status);
      setNotice({ tone: 'ok', text: data.message ?? 'Done.' });
      setConfirming(false);
      setEditing(false);
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Network error. Nothing was posted.' });
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy('reject');
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      if (!res.ok) throw new Error();
      setStatus('CANCELLED');
      setNotice({ tone: 'ok', text: 'Discarded. It will not be posted.' });
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Could not discard that draft.' });
    } finally {
      setBusy(null);
    }
  }

  const [deleteOnLinkedin, setDeleteOnLinkedin] = useState(false);

  async function deleteDraft(alsoOnLinkedin = false) {
    setBusy('delete');
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteOnLinkedin: alsoOnLinkedin }),
      });
      if (!res.ok) throw new Error();
      router.push('/drafts');
    } catch {
      setNotice({ tone: 'error', text: 'Could not delete this draft.' });
      setBusy(null);
      setConfirmingDelete(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ── preview / editor ── */}
      <div className="space-y-5">
        <div className="card">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <p className="label mb-0">{editing ? 'Editing' : 'Exactly what will be posted'}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${tooLong ? 'text-rust-500' : 'text-ink-500'}`}>
                {composedLength.toLocaleString()} / 3,000
              </span>
              <button
                type="button"
                onClick={() => setEditing((value) => !value)}
                className="btn btn-quiet btn-sm"
                disabled={isPublished || isCancelled}
              >
                {editing ? 'Preview' : 'Edit'}
              </button>
            </div>
          </div>

          {editing ? (
            <div className="space-y-4">
              <textarea
                className="textarea min-h-[18rem]"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                aria-label="Post body"
              />
              <div>
                <label className="label" htmlFor="hashtags">
                  Hashtags
                </label>
                <input
                  id="hashtags"
                  className="input"
                  value={hashtagText}
                  onChange={(e) => setHashtagText(e.target.value)}
                  placeholder="research openscience"
                />
              </div>

              {/* ── Picture / Image Attachment Section (Max 10) ── */}
              <div className="rounded-2xl border border-ink-900/10 bg-cream-50/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-ink-900">Post Pictures</p>
                      <span className="rounded-full bg-ink-900/10 px-2 py-0.5 text-[0.65rem] font-medium text-ink-700">
                        {images.length} / {MAX_IMAGES}
                      </span>
                    </div>
                    <p className="text-[0.7rem] text-ink-500">
                      Attach up to 10 images to this post (PNG, JPG, WEBP, or GIF up to 10MB each).
                    </p>
                  </div>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy !== null || images.length >= MAX_IMAGES}
                      className="btn btn-quiet btn-sm"
                    >
                      {busy === 'upload_image'
                        ? 'Uploading…'
                        : images.length === 0
                          ? 'Upload pictures'
                          : 'Add more pictures'}
                    </button>
                  </div>
                </div>

                {images.length > 0 && (
                  <div className="mt-3.5 space-y-2">
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {images.map((img, idx) => (
                        <div
                          key={img.id || idx}
                          className="group relative overflow-hidden rounded-xl border border-ink-900/10 bg-white p-1.5 shadow-xs"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.url}
                            alt={img.altText || `Picture ${idx + 1}`}
                            className="h-24 w-full rounded-lg object-cover"
                          />
                          <div className="mt-1 flex items-center justify-between px-1">
                            <span className="truncate text-[0.65rem] font-medium text-ink-600">
                              #{idx + 1} {img.altText || 'Image'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveImage(img.id)}
                              disabled={busy !== null}
                              className="text-[0.65rem] font-semibold text-rust-500 hover:text-rust-600"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {images.length > 1 && (
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          onClick={() => handleRemoveImage()}
                          disabled={busy !== null}
                          className="text-[0.7rem] text-rust-500 hover:underline"
                        >
                          Remove all pictures
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={busy !== null || !dirty}
                  className="btn btn-ink btn-sm"
                >
                  {busy === 'save' ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBody(draft.body);
                    setHashtagText(draft.hashtags.join(' '));
                  }}
                  disabled={!dirty}
                  className="btn btn-ghost btn-sm"
                >
                  Revert
                </button>
              </div>
            </div>
          ) : (
            <PostPreview
              body={body}
              hashtags={hashtags}
              authorName={authorName}
              authorHeadline={authorHeadline}
              authorAvatar={authorAvatar}
              imageUrl={images[0]?.url ?? null}
              imageAlt={images[0]?.altText ?? null}
              images={images}
              linkUrl={draft.linkUrl}
            />
          )}
        </div>

        {notice && (
          <p
            role="status"
            className={`rounded-2xl px-4 py-3 text-xs font-medium ${
              notice.tone === 'ok' ? 'bg-sage-100 text-sage-500' : 'bg-rust-100 text-rust-500'
            }`}
          >
            {notice.text}
          </p>
        )}
      </div>

      {/* ── decision panel ── */}
      <aside className="space-y-5">
        <div className="card-ink">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-clay-300">
            Approval
          </p>
          <p className="mt-2 text-sm leading-relaxed text-cream-100/70">
            {isPublished
              ? dryRun
                ? 'Marked as published. Dry-run mode was on, so nothing was actually sent to LinkedIn.'
                : 'This post is live on LinkedIn.'
              : isCancelled
                ? 'This draft has been discarded and cancelled.'
                : 'Nothing is sent to LinkedIn until you approve it here.'}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(status)}>{humanise(status)}</Badge>
            <Badge tone={statusTone(draft.verificationStatus)}>
              Fact-check: {humanise(draft.verificationStatus)}
            </Badge>
          </div>

          {!isPublished && !isCancelled && (
            <div className="mt-5 space-y-2.5">
              {dryRun && (
                <p className="rounded-2xl bg-amber-soft px-3.5 py-2.5 text-[0.7rem] leading-relaxed text-amber-warn">
                  Dry-run mode is on (LINKEDIN_DRY_RUN). Approving marks the post as published but
                  sends nothing to LinkedIn.
                </p>
              )}

              {!linkedinConnected && (
                <p className="rounded-2xl bg-cream-100/10 px-3.5 py-2.5 text-[0.7rem] leading-relaxed text-cream-100/70">
                  No LinkedIn account is connected, so publishing will fail.{' '}
                  <Link href="/settings" className="font-semibold text-clay-300 underline">
                    Connect one
                  </Link>
                  .
                </p>
              )}

              {confirming ? (
                <div className="space-y-2.5 rounded-2xl bg-cream-100/10 p-3.5">
                  <p className="text-[0.7rem] leading-relaxed text-cream-100/80">
                    Post this to your LinkedIn feed now?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void approve('publish')}
                      disabled={busy !== null || tooLong}
                      className="btn btn-primary btn-sm flex-1"
                    >
                      {busy === 'publish' ? 'Posting…' : 'Yes, post it'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      className="btn btn-sm flex-1 bg-cream-100/15 text-cream-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy !== null || tooLong}
                  className="btn btn-primary w-full"
                >
                  Approve &amp; publish now
                </button>
              )}

              <button
                type="button"
                onClick={() => void approve('approve')}
                disabled={busy !== null || tooLong}
                className="btn btn-sm w-full bg-cream-100/15 text-cream-100 hover:bg-cream-100/25"
              >
                {busy === 'approve' ? 'Approving…' : 'Approve only'}
              </button>

              <div className="rounded-2xl bg-cream-100/10 p-3.5">
                <label
                  className="mb-2 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-cream-100/60"
                  htmlFor="scheduleAt"
                >
                  Or schedule it
                </label>
                <input
                  id="scheduleAt"
                  type="datetime-local"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  className="w-full rounded-xl border border-cream-100/20 bg-transparent px-3 py-2 text-xs text-cream-100 [color-scheme:dark]"
                />
                <button
                  type="button"
                  onClick={() => void approve('schedule')}
                  disabled={busy !== null || !scheduleAt || tooLong}
                  className="btn btn-sm mt-2.5 w-full bg-cream-100/15 text-cream-100 hover:bg-cream-100/25"
                >
                  {busy === 'schedule' ? 'Scheduling…' : 'Approve & schedule'}
                </button>
              </div>

              <div className="flex items-center justify-between pt-1 text-[0.7rem]">
                <button
                  type="button"
                  onClick={() => void reject()}
                  disabled={busy !== null}
                  className="font-medium text-cream-100/50 hover:text-rust-500"
                >
                  {busy === 'reject' ? 'Discarding…' : 'Discard draft'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={busy !== null}
                  className="font-medium text-rust-500/80 hover:text-rust-500"
                >
                  Delete permanently
                </button>
              </div>
            </div>
          )}

          {/* ── Delete Action for Published Posts ── */}
          {isPublished && !confirmingDelete && (
            <div className="mt-5 pt-3 border-t border-cream-100/10">
              <button
                type="button"
                onClick={() => {
                  setDeleteOnLinkedin(false);
                  setConfirmingDelete(true);
                }}
                disabled={busy !== null}
                className="text-[0.75rem] text-rust-500/80 hover:text-rust-500 transition-colors"
              >
                Delete published post…
              </button>
            </div>
          )}

          {isCancelled && !confirmingDelete && (
            <div className="mt-5">
              <button
                type="button"
                onClick={() => {
                  setDeleteOnLinkedin(false);
                  setConfirmingDelete(true);
                }}
                disabled={busy !== null}
                className="btn btn-sm w-full bg-rust-100/20 text-rust-500 hover:bg-rust-100/30"
              >
                Delete permanently
              </button>
            </div>
          )}

          {confirmingDelete && (
            <div className="mt-5 space-y-3 rounded-2xl bg-rust-100/20 p-3.5 border border-rust-500/30">
              <p className="text-[0.75rem] font-semibold text-rust-500">
                {isPublished ? 'Delete published post?' : 'Permanently delete this draft?'}
              </p>
              <p className="text-[0.7rem] text-cream-100/80 leading-relaxed">
                {isPublished
                  ? 'This will remove the post from your local history and dashboard.'
                  : 'This cannot be undone.'}
              </p>

              {isPublished && (
                <label className="flex items-start gap-2.5 rounded-xl bg-ink-900/40 p-2.5 border border-rust-500/20 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deleteOnLinkedin}
                    onChange={(e) => setDeleteOnLinkedin(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-cream-100/30 text-rust-500 focus:ring-rust-500"
                  />
                  <div className="text-[0.7rem] text-cream-100">
                    <span className="font-semibold text-cream-50">Delete post on LinkedIn as well</span>
                    <p className="text-[0.65rem] text-cream-100/70">
                      If unchecked, the post will remain live on your LinkedIn profile.
                    </p>
                  </div>
                </label>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void deleteDraft(isPublished && deleteOnLinkedin)}
                  disabled={busy !== null}
                  className="btn btn-sm flex-1 bg-rust-500 text-cream-50 hover:bg-rust-500/90"
                >
                  {busy === 'delete' ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteOnLinkedin(false);
                  }}
                  disabled={busy !== null}
                  className="btn btn-sm flex-1 bg-cream-100/15 text-cream-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isPublished && draft.permalink && !confirmingDelete && (
            <a
              href={draft.permalink}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary mt-5 w-full"
            >
              View on LinkedIn ↗
            </a>
          )}
        </div>

        <div className="card space-y-3 text-xs">
          <p className="label mb-0">Details</p>
          <Row label="Format" value={humanise(draft.format)} />
          <Row label="Origin" value={draft.origin === 'CHAT' ? 'Written in chat' : 'Pipeline'} />
          {draft.paperTitle && <Row label="Paper" value={draft.paperTitle} />}
          {draft.scheduledFor && (
            <Row label="Scheduled" value={new Date(draft.scheduledFor).toLocaleString('en-GB')} />
          )}
          {tooLong && (
            <p className="rounded-xl bg-rust-100 px-3 py-2 text-[0.7rem] text-rust-500">
              Too long for LinkedIn by {(composedLength - MAX_LENGTH).toLocaleString()} characters.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-ink-500">{label}</span>
      <span className="min-w-0 flex-1 font-medium text-ink-800">{value}</span>
    </div>
  );
}
