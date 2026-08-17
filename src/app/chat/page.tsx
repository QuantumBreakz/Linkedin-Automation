import { requireSessionUser } from '@/lib/session';
import { PageShell, PageHeader, firstName } from '@/components/ui';
import { ChatWorkspace } from '@/components/ChatWorkspace';

export const metadata = { title: 'Chat — Researchly' };

export default async function ChatPage() {
  const user = await requireSessionUser();

  return (
    <PageShell compact>
      <PageHeader
        eyebrow="Writing room"
        description="Threads are private to your account. Save any reply as a post draft — it still has to pass the approval screen before it goes out."
      />
      <ChatWorkspace userId={user.id} userName={firstName(user.name) || 'there'} />
    </PageShell>
  );
}
