'use client';

import React, { useState, useEffect } from 'react';
import type { Tone, Technicality, PostLength, EmojiUsage } from '@prisma/client';

interface BrandSettings {
  tone: Tone;
  technicality: Technicality;
  postLength: PostLength;
  emojiUsage: EmojiUsage;
  ctaEnabled: boolean;
  hashtagsEnabled: boolean;
  firstPerson: boolean;
  customInstructions: string;
}

interface LinkedInAccountInfo {
  id: string;
  displayName: string | null;
  status: string;
  accessTokenExpires: string;
}

export default function SettingsPage() {
  const [brand, setBrand] = useState<BrandSettings>({
    tone: 'PROFESSIONAL',
    technicality: 'INTERMEDIATE',
    postLength: 'MEDIUM',
    emojiUsage: 'LOW',
    ctaEnabled: true,
    hashtagsEnabled: true,
    firstPerson: true,
    customInstructions: '',
  });

  const [linkedin, setLinkedin] = useState<LinkedInAccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings/brand');
      const data = await res.json();
      if (data.brand) {
        setBrand({
          tone: data.brand.tone ?? 'PROFESSIONAL',
          technicality: data.brand.technicality ?? 'INTERMEDIATE',
          postLength: data.brand.postLength ?? 'MEDIUM',
          emojiUsage: data.brand.emojiUsage ?? 'LOW',
          ctaEnabled: data.brand.ctaEnabled ?? true,
          hashtagsEnabled: data.brand.hashtagsEnabled ?? true,
          firstPerson: data.brand.firstPerson ?? true,
          customInstructions: data.brand.customInstructions ?? '',
        });
      }
      if (data.linkedin) setLinkedin(data.linkedin);
    } catch {
      setMsg({ type: 'error', text: 'Failed to load settings.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    try {
      const res = await fetch('/api/settings/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(brand),
      });

      if (res.ok) {
        setMsg({ type: 'success', text: 'Brand voice profile updated successfully!' });
      } else {
        setMsg({ type: 'error', text: 'Failed to update brand profile.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Error saving settings.' });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-10 text-center text-slate-400 text-xs">Loading settings...</div>;
  }

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Voice & Settings</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Customize your personal writing style, audience technicality, and LinkedIn account connection.
        </p>
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

      {/* LinkedIn Account Card */}
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center text-white font-bold text-lg">
              in
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">LinkedIn Account</h2>
              <p className="text-xs text-slate-400">
                {linkedin?.status === 'ACTIVE'
                  ? `Connected as ${linkedin.displayName || 'Member'} (Expires ${new Date(linkedin.accessTokenExpires).toLocaleDateString()})`
                  : 'Not connected. Connect your account to enable one-click and scheduled posting.'}
              </p>
            </div>
          </div>

          <a
            href="/api/linkedin/auth"
            className={`px-4 py-2 rounded-xl text-xs font-semibold shadow-md transition-all ${
              linkedin?.status === 'ACTIVE'
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                : 'bg-sky-600 hover:bg-sky-500 text-white'
            }`}
          >
            {linkedin?.status === 'ACTIVE' ? 'Reconnect Account' : 'Connect LinkedIn →'}
          </a>
        </div>
      </div>

      {/* Brand Voice Form */}
      <form onSubmit={handleSave} className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-6">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <span>🎙️</span> Brand Voice & Tone Profile
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Tone of Voice</label>
            <select
              value={brand.tone}
              onChange={(e) => setBrand({ ...brand, tone: e.target.value as Tone })}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="PROFESSIONAL">Professional & Authoritative</option>
              <option value="CONVERSATIONAL">Conversational & Engaging</option>
              <option value="ACADEMIC">Academic & Scholarly</option>
              <option value="ENTHUSIASTIC">Enthusiastic & Visionary</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Technical Depth</label>
            <select
              value={brand.technicality}
              onChange={(e) => setBrand({ ...brand, technicality: e.target.value as Technicality })}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="BEGINNER">Accessible (Plain language, broad reach)</option>
              <option value="INTERMEDIATE">Intermediate (Industry peers & technologists)</option>
              <option value="EXPERT">Expert (Domain specialists & researchers)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Target Post Length</label>
            <select
              value={brand.postLength}
              onChange={(e) => setBrand({ ...brand, postLength: e.target.value as PostLength })}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="SHORT">Short (~800 characters)</option>
              <option value="MEDIUM">Medium (~1,500 characters)</option>
              <option value="LONG">Long (~2,500 characters)</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Emoji Usage</label>
            <select
              value={brand.emojiUsage}
              onChange={(e) => setBrand({ ...brand, emojiUsage: e.target.value as EmojiUsage })}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="NONE">None (Strictly academic)</option>
              <option value="LOW">Low (1-2 tasteful accents)</option>
              <option value="MODERATE">Moderate (Key bullet callouts)</option>
            </select>
          </div>
        </div>

        {/* Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <label className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={brand.firstPerson}
              onChange={(e) => setBrand({ ...brand, firstPerson: e.target.checked })}
              className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
            />
            <span className="text-xs text-slate-300 font-medium">First Person ("I / We")</span>
          </label>

          <label className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={brand.hashtagsEnabled}
              onChange={(e) => setBrand({ ...brand, hashtagsEnabled: e.target.checked })}
              className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
            />
            <span className="text-xs text-slate-300 font-medium">Auto Hashtags</span>
          </label>

          <label className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={brand.ctaEnabled}
              onChange={(e) => setBrand({ ...brand, ctaEnabled: e.target.checked })}
              className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0"
            />
            <span className="text-xs text-slate-300 font-medium">Include Call to Action</span>
          </label>
        </div>

        {/* Custom Instructions */}
        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1.5">
            Custom Instructions / Bio Context
          </label>
          <textarea
            rows={3}
            value={brand.customInstructions}
            onChange={(e) => setBrand({ ...brand, customInstructions: e.target.value })}
            placeholder="e.g. Focus on climate tech implications. Mention that I run the BioLab at MIT. Avoid buzzwords like 'game-changer'."
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
          />
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Voice Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
