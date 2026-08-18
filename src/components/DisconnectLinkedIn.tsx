'use client';

/**
 * Disconnect button for the LinkedIn card in Settings. Two-step (confirm) so a
 * stray click can't sever the connection. On success it refreshes the server
 * component, which then re-renders the card in its "connect" state.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DisconnectLinkedIn() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch('/api/linkedin/disconnect', { method: 'POST' });
      router.refresh();
    } catch {
      // Non-fatal: the button just stays; the user can retry.
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-2 w-full text-[0.7rem] font-medium text-ink-500 hover:text-rust-500"
      >
        Disconnect
      </button>
    );
  }

  return (
    <div className="mt-2 flex gap-2">
      <button
        type="button"
        onClick={() => void disconnect()}
        disabled={busy}
        className="btn btn-sm flex-1 bg-rust-100 text-rust-500 hover:bg-rust-200"
      >
        {busy ? 'Disconnecting…' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="btn btn-quiet btn-sm flex-1"
      >
        Cancel
      </button>
    </div>
  );
}
