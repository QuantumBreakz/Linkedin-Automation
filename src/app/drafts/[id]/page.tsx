'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface DraftData {
  id: string;
  format: string;
  body: string;
  hashtags: string[];
  linkUrl: string | null;
  status: string;
  verificationStatus: string;
  verification: {
    claims?: Array<{
      text: string;
      status: 'SUPPORTED' | 'HEDGED_OK' | 'UNSUPPORTED' | 'CONTRADICTED';
      supportingField: string | null;
      note: string | null;
    }>;
    overstatement?: boolean;
    medicalAdviceRisk?: boolean;
    numbersMatch?: boolean;
    verdict?: string;
  } | null;
  paper: {
    id: string;
    title: string;
    venue: string | null;
    abstract: string | null;
    landingUrl: string | null;
    doi: string | null;
    authors: Array<{ name: string }>;
  };
  visuals?: Array<{
    id: string;
    template: string;
    spec: Record<string, unknown>;
    storageKey: string | null;
  }>;
  published?: {
    linkedinUrn: string | null;
    permalink: string | null;
    publishedAt: string | null;
  } | null;
}

export default function DraftEditorPage() {
  const params = useParams();
  const router = useRouter();
  const draftId = params['id'] as string;

  const [draft, setDraft] = useState<DraftData | null>(null);
  const [body, setBody] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/drafts/${draftId}`);
        const data = await res.json();
        if (data.draft) {
          setDraft(data.draft);
          setBody(data.draft.body);
          setHashtags(data.draft.hashtags.join(' '));
        }
      } catch {
        setMsg({ type: 'error', text: 'Failed to load draft.' });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [draftId]);

  async function handleSave(statusOverride?: string) {
    setSaving(true);
    setMsg(null);
    try {
      const parsedHashtags = hashtags
        .split(/\s+/)
        .map((h) => h.trim())
        .filter(Boolean);

      const res = await fetch(`/api/drafts/${draftId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          hashtags: parsedHashtags,
          status: statusOverride ?? draft?.status,
        }),
      });

      if (res.ok) {
        const updated = await res.json();
        setDraft(updated.draft);
        setMsg({ type: 'success', text: 'Changes saved successfully!' });
      } else {
        setMsg({ type: 'error', text: 'Failed to save changes.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Error saving draft.' });
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!confirm('Are you sure you want to publish this post to LinkedIn now?')) return;
    setPublishing(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/drafts/${draftId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      if (res.ok) {
        setMsg({ type: 'success', text: 'Publish job queued! Your post is going live.' });
        setTimeout(() => router.push('/drafts?status=PUBLISHED'), 1500);
      } else {
        const err = await res.json();
        setMsg({ type: 'error', text: err.error || 'Failed to queue publish job.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Network error publishing post.' });
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <div className="p-10 flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="p-10 text-center space-y-4">
        <p className="text-slate-400">Draft not found.</p>
        <Link href="/drafts" className="text-indigo-400 font-semibold hover:underline">
          ← Back to drafts
        </Link>
      </div>
    );
  }

  const charCount = body.length;
  const isOverCharLimit = charCount > 3000;
  const visual = draft.visuals?.[0];

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/drafts"
              className="text-xs font-semibold text-slate-400 hover:text-white transition-colors"
            >
              ← All Drafts
            </Link>
            <span className="text-slate-600">/</span>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/20 text-indigo-300">
              {draft.format.replace(/_/g, ' ')}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white mt-1 line-clamp-1">
            {draft.paper.title}
          </h1>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => handleSave()}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-200 hover:bg-slate-800 transition-all"
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>

          {draft.status === 'NEEDS_REVIEW' && (
            <button
              onClick={() => handleSave('APPROVED')}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-all"
            >
              Approve Post ✓
            </button>
          )}

          {draft.status !== 'PUBLISHED' && (
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-1.5"
            >
              {publishing ? 'Publishing...' : '🚀 Publish to LinkedIn'}
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div
          className={`p-4 rounded-xl text-xs font-medium ${
            msg.type === 'success'
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Main Grid: Left Editor / Right Verification Audit */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Post Editor & Visuals (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Post Content
              </label>
              <span
                className={`text-xs font-semibold ${
                  isOverCharLimit ? 'text-rose-400' : 'text-slate-400'
                }`}
              >
                {charCount} / 3,000 characters
              </span>
            </div>

            <textarea
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-4 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors leading-relaxed resize-y font-sans"
              placeholder="Post body..."
            />

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Hashtags
              </label>
              <input
                type="text"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                placeholder="#Research #AI #Biotech"
              />
            </div>
          </div>

          {/* Visual Asset Card Preview */}
          {visual && (
            <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                  <span>🎨</span> Generated Visual Card
                </h3>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  Template: {visual.template}
                </span>
              </div>
              <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 text-xs">
                <p className="font-semibold text-slate-200">
                  Headline: {String(visual.spec['headline'] ?? '')}
                </p>
                {Boolean(visual.spec['stat']) && (
                  <p className="text-indigo-400 font-bold text-sm">
                    Stat: {String(visual.spec['stat'])} ({String(visual.spec['statLabel'] ?? '')})
                  </p>
                )}
                <p className="text-slate-400">Context: {String(visual.spec['context'] ?? '')}</p>
                <p className="text-[11px] text-slate-500">Source: {String(visual.spec['source'] ?? '')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Stage 4 Verification Audit Report (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>🛡️</span> Fact-Check & Verification Report
              </h2>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                  draft.verificationStatus === 'PASSED'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : draft.verificationStatus === 'FLAGGED'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                }`}
              >
                {draft.verificationStatus}
              </span>
            </div>

            {/* Audit Checklist */}
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                <span className="text-slate-300 font-medium">Numeral Tracing</span>
                {draft.verification?.numbersMatch !== false ? (
                  <span className="text-emerald-400 font-bold">✓ Matches Source</span>
                ) : (
                  <span className="text-rose-400 font-bold">✗ Unverified Numbers</span>
                )}
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                <span className="text-slate-300 font-medium">Causal Overstatement Guard</span>
                {!draft.verification?.overstatement ? (
                  <span className="text-emerald-400 font-bold">✓ Accurately Hedged</span>
                ) : (
                  <span className="text-amber-400 font-bold">⚠ Causal Claims Flagged</span>
                )}
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/60">
                <span className="text-slate-300 font-medium">Medical Advice Risk</span>
                {!draft.verification?.medicalAdviceRisk ? (
                  <span className="text-emerald-400 font-bold">✓ No Medical Claims</span>
                ) : (
                  <span className="text-rose-400 font-bold">✗ Medical Risk Detected</span>
                )}
              </div>
            </div>

            {/* Claim-by-Claim Verified Spans */}
            {draft.verification?.claims && draft.verification.claims.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-slate-800/80">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Claim-by-Claim Breakdown
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {draft.verification.claims.map((claim, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/60 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            claim.status === 'SUPPORTED'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : claim.status === 'HEDGED_OK'
                                ? 'bg-indigo-500/20 text-indigo-300'
                                : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {claim.status}
                        </span>
                        {claim.supportingField && (
                          <span className="text-[10px] text-slate-500">
                            Field: {claim.supportingField}
                          </span>
                        )}
                      </div>
                      <p className="text-slate-300 text-[11px]">{claim.text}</p>
                      {claim.note && <p className="text-slate-500 text-[10px]">{claim.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Paper Metadata Context */}
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-2.5 text-xs">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Source Paper Info
            </h3>
            <p className="font-semibold text-slate-200">{draft.paper.title}</p>
            {draft.paper.venue && (
              <p className="text-slate-400">Journal: {draft.paper.venue}</p>
            )}
            <p className="text-slate-400">
              Authors: {draft.paper.authors.map((a) => a.name).join(', ')}
            </p>
            {draft.paper.landingUrl && (
              <a
                href={draft.paper.landingUrl}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:text-indigo-300 font-semibold block pt-1"
              >
                Open Original Paper ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
