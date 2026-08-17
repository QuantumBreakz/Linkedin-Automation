'use client';

/**
 * Connect a research source.
 *
 * The identifier is validated by the adapter server-side before the row is
 * written, so a typo in an ORCID iD fails here with a readable message rather
 * than silently producing a source that never syncs.
 */

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const KINDS = [
  {
    value: 'ORCID',
    label: 'ORCID iD',
    placeholder: '0000-0002-1825-0097',
    hint: 'Your full works list, enriched by DOI.',
  },
  {
    value: 'OPENALEX_AUTHOR',
    label: 'OpenAlex author',
    placeholder: 'A5023880391',
    hint: 'Broad coverage, updated daily.',
  },
  {
    value: 'ARXIV_AUTHOR',
    label: 'arXiv author',
    placeholder: 'Hinton_G',
    hint: 'Preprints as they are posted.',
  },
  {
    value: 'PUBMED_QUERY',
    label: 'PubMed query',
    placeholder: 'Rahman A[Author] AND immunology',
    hint: 'Any valid E-utilities search.',
  },
  {
    value: 'CROSSREF_QUERY',
    label: 'Crossref query',
    placeholder: 'protein folding kinetics',
    hint: 'Metadata across publishers.',
  },
  {
    value: 'MANUAL_DOI',
    label: 'Single DOI',
    placeholder: '10.1038/s41586-020-2649-2',
    hint: 'Add one paper by hand.',
  },
] as const;

export function AddSourceForm() {
  const router = useRouter();
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('ORCID');
  const [identifier, setIdentifier] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const active = KINDS.find((k) => k.value === kind)!;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!identifier.trim()) return;

    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, identifier: identifier.trim(), label: label.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };

      if (!res.ok) {
        setNotice({ tone: 'error', text: data.error ?? 'That source could not be added.' });
        return;
      }

      setNotice({ tone: 'ok', text: 'Connected. The first poll is already running.' });
      setIdentifier('');
      setLabel('');
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Network error adding that source.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <p className="label">Connect a source</p>

      {notice && (
        <p
          role="status"
          className={`mb-4 rounded-2xl px-4 py-3 text-xs font-medium ${
            notice.tone === 'ok' ? 'bg-sage-100 text-sage-500' : 'bg-rust-100 text-rust-500'
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-12">
        <div className="sm:col-span-3">
          <select
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            aria-label="Source type"
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-5">
          <input
            className="input"
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={active.placeholder}
            aria-label="Identifier"
          />
        </div>

        <div className="sm:col-span-2">
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            aria-label="Label"
          />
        </div>

        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy ? 'Checking…' : 'Connect'}
          </button>
        </div>
      </div>

      <p className="mt-2.5 text-xs text-ink-500">{active.hint}</p>
    </form>
  );
}
