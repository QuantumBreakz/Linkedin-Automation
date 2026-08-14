'use client';

import React, { useState, useEffect } from 'react';
import type { SourceKind } from '@prisma/client';

interface SourceRecord {
  id: string;
  kind: SourceKind;
  identifier: string;
  label: string | null;
  syncStatus: string;
  lastCheckedAt: string | null;
  _count?: { links: number };
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [kind, setKind] = useState<SourceKind>('OPENALEX_AUTHOR');
  const [identifier, setIdentifier] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadSources();
  }, []);

  async function loadSources() {
    try {
      const res = await fetch('/api/sources');
      const data = await res.json();
      if (data.sources) setSources(data.sources);
    } catch {
      setError('Failed to load sources');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, identifier: identifier.trim(), label: label.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        setSuccess('Source validated and connected! Automatic paper discovery is running in the background.');
        setIdentifier('');
        setLabel('');
        loadSources();
      } else {
        setError(data.error || 'Failed to add source');
      }
    } catch {
      setError('Network error adding source');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Research Sources</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Connect your academic identifiers to automatically discover and ingest your latest publications.
        </p>
      </div>

      {/* Add New Source Form */}
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-5">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>🔗</span> Connect Academic Profile
        </h2>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">
            {error}
          </div>
        )}

        {success && (
          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-3">
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Source Type</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SourceKind)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="OPENALEX_AUTHOR">OpenAlex Author ID</option>
              <option value="ORCID">ORCID iD</option>
            </select>
          </div>

          <div className="md:col-span-5">
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              {kind === 'ORCID' ? 'ORCID ID (e.g. 0000-0002-1825-0097)' : 'OpenAlex Author ID (e.g. A5023880391)'}
            </label>
            <input
              type="text"
              required
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder={kind === 'ORCID' ? '0000-0002-1825-0097' : 'A5023880391'}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Custom Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My Lab / Primary"
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50"
            >
              {submitting ? 'Verifying...' : '+ Connect Source'}
            </button>
          </div>
        </form>
      </div>

      {/* Connected Sources List */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-white">Connected Sources</h2>

        {loading ? (
          <div className="p-8 text-center text-slate-400 text-xs">Loading sources...</div>
        ) : sources.length === 0 ? (
          <div className="p-8 text-center rounded-2xl border border-slate-800 bg-slate-900/40 text-slate-400 text-xs">
            No research sources connected yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {sources.map((src) => (
              <div
                key={src.id}
                className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-800 text-slate-300">
                      {src.kind.replace(/_/g, ' ')}
                    </span>
                    {src.label && (
                      <span className="text-xs font-medium text-slate-300">({src.label})</span>
                    )}
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                        src.syncStatus === 'OK'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : src.syncStatus === 'FAILING'
                            ? 'bg-rose-500/20 text-rose-300'
                            : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {src.syncStatus}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">{src.identifier}</p>
                </div>

                <div className="text-right text-xs text-slate-400">
                  <p>{src._count?.links ?? 0} papers linked</p>
                  {src.lastCheckedAt && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Last sync: {new Date(src.lastCheckedAt).toLocaleTimeString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
