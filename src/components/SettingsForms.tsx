'use client';

/**
 * The two settings forms — who you are, and how you sound.
 *
 * Both are seeded from server-rendered props, so they paint with real values
 * instead of flashing defaults and then correcting themselves.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

type Notice = { tone: 'ok' | 'error'; text: string } | null;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role="status"
      className={`rounded-2xl px-4 py-3 text-xs font-medium ${
        notice.tone === 'ok' ? 'bg-sage-100 text-sage-500' : 'bg-rust-100 text-rust-500'
      }`}
    >
      {notice.text}
    </p>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

// ────────────────────────────────  profile  ────────────────────────────────

export interface ProfileValues {
  name: string;
  title: string;
  fieldOfStudy: string;
  bio: string;
  timezone: string;
  researchAreas: string;
  approvalMode: 'AUTOMATIC' | 'APPROVAL_REQUIRED' | 'DRAFT_ONLY';
}

export function ProfileSettingsForm({ initial, email }: { initial: ProfileValues; email: string }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  function set<K extends keyof ProfileValues>(key: K, value: ProfileValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/settings/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          title: values.title || null,
          fieldOfStudy: values.fieldOfStudy || null,
          bio: values.bio || null,
          timezone: values.timezone,
          approvalMode: values.approvalMode,
          researchAreas: values.researchAreas
            .split(',')
            .map((area) => area.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error();
      setNotice({ tone: 'ok', text: 'Profile saved.' });
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Could not save your profile.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Basic information</h2>
        <p className="mt-1 text-xs text-ink-500">
          Used to attribute posts and to tell the assistant who it is writing for.
        </p>
      </div>

      <NoticeLine notice={notice} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name">
          <input
            className="input"
            required
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>

        <Field label="Email">
          <input className="input opacity-60" value={email} readOnly aria-readonly />
        </Field>

        <Field label="Title">
          <input
            className="input"
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Senior Research Fellow"
          />
        </Field>

        <Field label="Field of study">
          <input
            className="input"
            value={values.fieldOfStudy}
            onChange={(e) => set('fieldOfStudy', e.target.value)}
            placeholder="Computational biology"
          />
        </Field>

        <Field label="Timezone">
          <input
            className="input"
            value={values.timezone}
            onChange={(e) => set('timezone', e.target.value)}
            placeholder="Europe/London"
          />
        </Field>

        <Field label="Research areas (comma separated)">
          <input
            className="input"
            value={values.researchAreas}
            onChange={(e) => set('researchAreas', e.target.value)}
            placeholder="protein folding, ML for biology"
          />
        </Field>
      </div>

      <Field label="About you">
        <textarea
          className="textarea min-h-24"
          value={values.bio}
          onChange={(e) => set('bio', e.target.value)}
          placeholder="A sentence or two the assistant can use for context."
        />
      </Field>

      <Field label="Approval mode">
        <select
          className="select"
          value={values.approvalMode}
          onChange={(e) => set('approvalMode', e.target.value as ProfileValues['approvalMode'])}
        >
          <option value="APPROVAL_REQUIRED">
            Approval required — nothing posts until I approve it
          </option>
          <option value="DRAFT_ONLY">Draft only — never publish, even on approval</option>
          <option value="AUTOMATIC">Automatic — approve new drafts on my behalf</option>
        </select>
      </Field>

      {values.approvalMode === 'AUTOMATIC' && (
        <p className="rounded-2xl bg-amber-soft px-4 py-3 text-xs leading-relaxed text-amber-warn">
          On automatic, drafts are approved as they are generated and go out on your schedule
          without a second look. Most people should leave this on “approval required”.
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}

// ─────────────────────────────────  voice  ─────────────────────────────────

export interface BrandValues {
  tone: string;
  technicality: string;
  postLength: string;
  emojiUsage: string;
  ctaEnabled: boolean;
  hashtagsEnabled: boolean;
  firstPerson: boolean;
  customInstructions: string;
}

const TONES = [
  ['PROFESSIONAL', 'Professional and authoritative'],
  ['CONVERSATIONAL', 'Conversational and engaging'],
  ['ACADEMIC', 'Academic and scholarly'],
  ['ENTHUSIASTIC', 'Enthusiastic and visionary'],
] as const;

const TECHNICALITIES = [
  ['BEGINNER', 'Accessible — plain language'],
  ['INTERMEDIATE', 'Intermediate — informed peers'],
  ['EXPERT', 'Expert — domain specialists'],
] as const;

const LENGTHS = [
  ['SHORT', 'Short — around 800 characters'],
  ['MEDIUM', 'Medium — around 1,500'],
  ['LONG', 'Long — around 2,500'],
] as const;

const EMOJI = [
  ['NONE', 'None'],
  ['LOW', 'Low — one or two'],
  ['MODERATE', 'Moderate — as section markers'],
] as const;

export function VoiceSettingsForm({ initial }: { initial: BrandValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  function set<K extends keyof BrandValues>(key: K, value: BrandValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/settings/brand', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw new Error();
      setNotice({ tone: 'ok', text: 'Voice profile saved.' });
      router.refresh();
    } catch {
      setNotice({ tone: 'error', text: 'Could not save your voice profile.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-5">
      <div>
        <h2 className="text-base font-semibold tracking-tight text-ink-900">Voice</h2>
        <p className="mt-1 text-xs text-ink-500">
          Applied to every generated draft and to the chat assistant.
        </p>
      </div>

      <NoticeLine notice={notice} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tone">
          <select className="select" value={values.tone} onChange={(e) => set('tone', e.target.value)}>
            {TONES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Technical depth">
          <select
            className="select"
            value={values.technicality}
            onChange={(e) => set('technicality', e.target.value)}
          >
            {TECHNICALITIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Post length">
          <select
            className="select"
            value={values.postLength}
            onChange={(e) => set('postLength', e.target.value)}
          >
            {LENGTHS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Emoji">
          <select
            className="select"
            value={values.emojiUsage}
            onChange={(e) => set('emojiUsage', e.target.value)}
          >
            {EMOJI.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Toggle
          label="First person"
          checked={values.firstPerson}
          onChange={(v) => set('firstPerson', v)}
        />
        <Toggle
          label="Hashtags"
          checked={values.hashtagsEnabled}
          onChange={(v) => set('hashtagsEnabled', v)}
        />
        <Toggle
          label="Call to action"
          checked={values.ctaEnabled}
          onChange={(v) => set('ctaEnabled', v)}
        />
      </div>

      <Field label="Standing instructions">
        <textarea
          className="textarea min-h-24"
          value={values.customInstructions}
          onChange={(e) => set('customInstructions', e.target.value)}
          placeholder="Avoid the phrase 'game-changer'. Mention the lab when it is relevant."
        />
      </Field>

      <div className="flex justify-end">
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? 'Saving…' : 'Save voice'}
        </button>
      </div>
    </form>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-cream-50 px-4 py-3.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--color-clay-500)]"
      />
      <span className="text-xs font-medium text-ink-700">{label}</span>
    </label>
  );
}
