'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeleteDraftButton({
  draftId,
  isPublished = false,
}: {
  draftId: string;
  isPublished?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleteOnLinkedin, setDeleteOnLinkedin] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDeleting(true);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deleteOnLinkedin: isPublished && deleteOnLinkedin,
        }),
      });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setConfirming(false);
      setDeleteOnLinkedin(false);
    }
  }

  if (confirming && isPublished) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 backdrop-blur-xs p-4"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(false);
          setDeleteOnLinkedin(false);
        }}
      >
        <div
          className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl border border-ink-900/10 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-ink-900">Delete published post?</h4>
            <p className="text-xs text-ink-600 leading-relaxed">
              This post has already been published to LinkedIn. Would you also like to delete it from LinkedIn?
            </p>
          </div>

          <label className="flex items-start gap-2.5 rounded-2xl bg-cream-100/50 p-3 border border-ink-900/8 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteOnLinkedin}
              onChange={(e) => setDeleteOnLinkedin(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-ink-900/20 text-rust-500 focus:ring-rust-500"
            />
            <div className="text-xs text-ink-800">
              <span className="font-semibold text-ink-900">Delete post on LinkedIn as well</span>
              <p className="text-[0.65rem] text-ink-500 mt-0.5">
                If unchecked, the post will only be removed from your app history.
              </p>
            </div>
          </label>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="btn btn-sm flex-1 bg-rust-500 text-cream-50 hover:bg-rust-500/90"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConfirming(false);
                setDeleteOnLinkedin(false);
              }}
              disabled={deleting}
              className="btn btn-ghost btn-sm flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <span className="text-[0.7rem] text-rust-500 font-medium">Delete?</span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-lg bg-rust-500 px-2 py-0.5 text-[0.7rem] font-semibold text-cream-50 hover:bg-rust-500/90"
        >
          {deleting ? '…' : 'Yes'}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setConfirming(false);
          }}
          disabled={deleting}
          className="rounded-lg bg-ink-900/5 px-2 py-0.5 text-[0.7rem] font-semibold text-ink-700 hover:bg-ink-900/10"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setConfirming(true);
      }}
      title="Delete post"
      className="text-[0.75rem] text-ink-400 transition-colors hover:text-rust-500 p-1"
    >
      Delete
    </button>
  );
}
