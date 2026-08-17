import Link from 'next/link';
import { db } from '@/lib/db';
import { requireSessionUser } from '@/lib/session';
import {
  PageShell,
  PageHeader,
  TabBar,
  Card,
  Badge,
  Avatar,
  statusTone,
  humanise,
  formatDate,
} from '@/components/ui';
import { ProfileSettingsForm, VoiceSettingsForm } from '@/components/SettingsForms';

export const metadata = { title: 'Profile — Researchly' };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ linkedin?: string; error?: string }>;
}) {
  const user = await requireSessionUser();
  const { linkedin: linkedinParam, error } = await searchParams;

  const [profile, brand, account, counts] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        email: true,
        name: true,
        title: true,
        fieldOfStudy: true,
        bio: true,
        timezone: true,
        researchAreas: true,
        approvalMode: true,
        createdAt: true,
      },
    }),
    // Created on signup; upserted here so an older account cannot 500 the page.
    db.brandProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    }),
    db.linkedInAccount.findUnique({
      where: { userId: user.id },
      select: {
        displayName: true,
        avatarUrl: true,
        status: true,
        accessTokenExpires: true,
        scopes: true,
      },
    }),
    db.contentDraft.groupBy({
      by: ['status'],
      where: { userId: user.id },
      _count: true,
    }),
  ]);

  const published = counts.find((c) => c.status === 'PUBLISHED')?._count ?? 0;
  const pending = counts.find((c) => c.status === 'NEEDS_REVIEW')?._count ?? 0;
  const connected = account?.status === 'ACTIVE';

  return (
    <PageShell>
      <PageHeader eyebrow="Your account" />

      <section className="card-ink mb-5 flex flex-col gap-6 p-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5">
          <Avatar name={profile.name} src={account?.avatarUrl} size={72} tone="clay" />
          <div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-clay-300">
              {profile.title ?? 'Researcher'}
            </p>
            <h1 className="mt-1 text-3xl font-semibold uppercase tracking-tight">{profile.name}</h1>
            <p className="mt-1 text-xs text-cream-100/55">
              {profile.email} · joined {formatDate(profile.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex gap-10">
          <div>
            <p className="text-3xl font-semibold">{published}</p>
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-cream-100/50">Published</p>
          </div>
          <div>
            <p className="text-3xl font-semibold">{pending}</p>
            <p className="text-[0.65rem] uppercase tracking-[0.16em] text-cream-100/50">Pending</p>
          </div>
        </div>
      </section>

      <TabBar
        current="/settings"
        tabs={[
          { href: '/settings', label: 'Profile' },
          { href: '/schedule', label: 'Schedule' },
          { href: '/sources', label: 'Sources' },
        ]}
      />

      {linkedinParam === 'connected' && (
        <p className="mb-5 rounded-2xl bg-sage-100 px-4 py-3 text-xs font-medium text-sage-500">
          LinkedIn connected. You can publish from the approval screen now.
        </p>
      )}
      {error && (
        <p className="mb-5 rounded-2xl bg-rust-100 px-4 py-3 text-xs font-medium text-rust-500">
          LinkedIn connection failed ({humanise(error)}). Try connecting again.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <ProfileSettingsForm
            email={profile.email}
            initial={{
              name: profile.name,
              title: profile.title ?? '',
              fieldOfStudy: profile.fieldOfStudy ?? '',
              bio: profile.bio ?? '',
              timezone: profile.timezone,
              researchAreas: profile.researchAreas.join(', '),
              approvalMode: profile.approvalMode,
            }}
          />

          <VoiceSettingsForm
            initial={{
              tone: brand.tone,
              technicality: brand.technicality,
              postLength: brand.postLength,
              emojiUsage: brand.emojiUsage,
              ctaEnabled: brand.ctaEnabled,
              hashtagsEnabled: brand.hashtagsEnabled,
              firstPerson: brand.firstPerson,
              customInstructions: brand.customInstructions ?? '',
            }}
          />
        </div>

        <aside className="space-y-5">
          <Card>
            <p className="label">LinkedIn</p>
            {connected && account ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar name={account.displayName ?? profile.name} src={account.avatarUrl} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {account.displayName ?? 'Connected'}
                    </p>
                    <p className="text-xs text-ink-500">
                      Expires {formatDate(account.accessTokenExpires)}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <Badge tone={statusTone(account.status)}>{humanise(account.status)}</Badge>
                </div>
                <p className="mt-3 text-[0.7rem] leading-relaxed text-ink-500">
                  Scopes: {account.scopes.join(', ') || '—'}
                </p>
                <a href="/api/linkedin/auth" className="btn btn-quiet btn-sm mt-4 w-full">
                  Reconnect
                </a>
              </>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-ink-700">
                  Connect the account posts should go out from. Tokens are encrypted at rest and
                  scoped to you alone.
                </p>
                <a href="/api/linkedin/auth" className="btn btn-primary btn-sm mt-4 w-full">
                  Connect LinkedIn →
                </a>
              </>
            )}
          </Card>

          <Card>
            <p className="label">Your data</p>
            <p className="text-xs leading-relaxed text-ink-600">
              Papers, drafts, chats and connections are keyed to your account and are not visible to
              any other user of this deployment. Deleting your account removes all of it.
            </p>
            <Link href="/chat" className="btn btn-ghost btn-sm mt-4 w-full">
              Back to chat
            </Link>
          </Card>
        </aside>
      </div>
    </PageShell>
  );
}
