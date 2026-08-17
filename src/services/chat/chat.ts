/**
 * The chat assistant.
 *
 * A per-user writing room: threads of messages, each thread owned by exactly
 * one account. Every function here takes a `userId` and every query filters on
 * it — there is no "load conversation by id" path that skips the owner check,
 * because that is precisely the mistake that leaks one researcher's unposted
 * drafts into another's sidebar.
 *
 * Prompt safety: user text goes in as `messages`, never concatenated into the
 * system prompt (the provider keeps them separate — see
 * services/llm/provider.ts). The brand profile *is* trusted, so it is
 * summarised into the system prompt.
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { openRouterProvider } from '@/services/llm/provider';
import type { Message } from '@/services/llm/types';
import type { ChatMessage, BrandProfile, User } from '@prisma/client';

/** How much history is replayed to the model. Older turns stay in the UI. */
const HISTORY_TURNS = 20;

/** Long enough for a full post plus commentary, short enough to stay cheap. */
const MAX_REPLY_TOKENS = 1400;

export const MAX_CHAT_MESSAGE_LENGTH = 6000;

// ────────────────────────────  system prompt  ────────────────────────────

function describeBrand(brand: BrandProfile | null): string {
  if (!brand) return 'No saved voice profile yet — write clean, professional prose.';
  return [
    `Tone: ${brand.tone.toLowerCase()}.`,
    `Technical level: ${brand.technicality.toLowerCase()}.`,
    `Preferred length: ${brand.postLength.toLowerCase()}.`,
    `Emoji usage: ${brand.emojiUsage.toLowerCase()}.`,
    brand.firstPerson ? 'Writes in first person.' : 'Avoids first person.',
    brand.ctaEnabled ? 'Ends with a light call to action.' : 'No call to action.',
    brand.hashtagsEnabled ? 'Hashtags are welcome.' : 'No hashtags.',
    brand.customInstructions ? `Standing instruction: ${brand.customInstructions}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function buildSystemPrompt(
  user: Pick<User, 'name' | 'title' | 'fieldOfStudy' | 'researchAreas'>,
  brand: BrandProfile | null,
): string {
  return [
    'You are the writing assistant inside a research-to-LinkedIn publishing tool.',
    'You help one researcher plan, draft, and sharpen LinkedIn posts about their own published work.',
    '',
    'About the person you are helping:',
    `- Name: ${user.name}`,
    user.title ? `- Role: ${user.title}` : '',
    user.fieldOfStudy ? `- Field: ${user.fieldOfStudy}` : '',
    user.researchAreas.length > 0 ? `- Research areas: ${user.researchAreas.join(', ')}` : '',
    '',
    `Their voice profile: ${describeBrand(brand)}`,
    '',
    'How to behave:',
    '- When asked for a post, return the post text itself, ready to paste. No preamble like "Here is your post".',
    '- Never invent statistics, sample sizes, journal names, or findings. If a number is not in what the user told you, do not write a number.',
    '- Claims about research must stay within what the user has actually said. Hedge honestly rather than overstating.',
    '- Keep posts under 3000 characters; LinkedIn truncates around 210 characters, so make the opening line earn the click.',
    '- Plain text only. LinkedIn renders no markdown, so no **bold**, no bullet syntax beyond simple dashes or emoji.',
    '- If the request is vague, ask one focused question rather than guessing at length.',
    '',
    'The user can save any reply of yours as a post draft, which then goes through their approval and publishing flow.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ────────────────────────────  conversations  ────────────────────────────

export async function listConversations(userId: string, includeArchived = false) {
  return db.chatConversation.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: [{ pinned: 'desc' }, { lastMessageAt: 'desc' }],
    select: {
      id: true,
      title: true,
      pinned: true,
      archived: true,
      lastMessageAt: true,
      createdAt: true,
      messages: {
        where: { role: 'ASSISTANT' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, role: true },
      },
      _count: { select: { messages: true } },
    },
    take: 100,
  });
}

export async function createConversation(userId: string, title?: string) {
  return db.chatConversation.create({
    data: { userId, title: title?.trim() || 'New chat' },
    select: { id: true, title: true, pinned: true, archived: true, lastMessageAt: true, createdAt: true },
  });
}

/** Returns null when the conversation does not exist *or* belongs to someone else. */
export async function getConversation(userId: string, conversationId: string) {
  return db.chatConversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true, title: true, pinned: true, archived: true, lastMessageAt: true },
  });
}

export async function listMessages(userId: string, conversationId: string) {
  return db.chatMessage.findMany({
    where: { conversationId, userId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      content: true,
      draftId: true,
      createdAt: true,
    },
  });
}

// ────────────────────────────  sending a turn  ───────────────────────────

export interface SendResult {
  userMessage: Pick<ChatMessage, 'id' | 'role' | 'content' | 'createdAt' | 'draftId'>;
  assistantMessage: Pick<ChatMessage, 'id' | 'role' | 'content' | 'createdAt' | 'draftId'>;
  conversationTitle: string;
}

/**
 * Appends the user's turn, asks the model, appends the reply.
 *
 * If the model call fails the user's message is still saved — losing what
 * someone typed because an upstream API had a bad minute is worse than
 * showing them an error they can retry.
 */
export async function sendMessage(args: {
  userId: string;
  conversationId: string;
  content: string;
}): Promise<SendResult | null> {
  const { userId, conversationId } = args;
  const content = args.content.trim().slice(0, MAX_CHAT_MESSAGE_LENGTH);
  if (!content) return null;

  const conversation = await getConversation(userId, conversationId);
  if (!conversation) return null;

  const [user, brand, history] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, title: true, fieldOfStudy: true, researchAreas: true },
    }),
    db.brandProfile.findUnique({ where: { userId } }),
    db.chatMessage.findMany({
      where: { conversationId, userId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
      select: { role: true, content: true },
    }),
  ]);

  const userMessage = await db.chatMessage.create({
    data: { conversationId, userId, role: 'USER', content },
    select: { id: true, role: true, content: true, createdAt: true, draftId: true },
  });

  const messages: Message[] = [
    ...history
      .reverse()
      .map((m): Message => ({ role: m.role === 'USER' ? 'user' : 'assistant', content: m.content })),
    { role: 'user', content },
  ];

  let reply: string;
  let meta: Record<string, unknown> = {};
  try {
    const result = await openRouterProvider.complete({
      role: 'standard',
      system: buildSystemPrompt(user, brand),
      messages,
      temperature: 0.7,
      maxTokens: MAX_REPLY_TOKENS,
      userId,
      purpose: 'chat',
      refType: 'conversation',
      refId: conversationId,
    });
    reply = result.text.trim();
    meta = { modelId: result.modelId, latencyMs: result.latencyMs };
  } catch (err) {
    logger.error('Chat completion failed', { conversationId, err });
    reply =
      'I could not reach the language model just now. Your message is saved — send it again in a moment.';
    meta = { error: true };
  }

  const assistantMessage = await db.chatMessage.create({
    data: { conversationId, userId, role: 'ASSISTANT', content: reply, meta: meta as object },
    select: { id: true, role: true, content: true, createdAt: true, draftId: true },
  });

  // First exchange names the thread, the way a chat sidebar is expected to
  // behave. Later turns leave a user-renamed title alone.
  const title =
    conversation.title === 'New chat' ? titleFrom(content) : conversation.title;

  await db.chatConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date(), title },
  });

  return { userMessage, assistantMessage, conversationTitle: title };
}

/** First clause of the opening message, capped. Deterministic and free. */
export function titleFrom(text: string): string {
  const firstLine = text.replace(/\s+/g, ' ').trim();
  const clause = firstLine.split(/[.?!\n]/)[0] ?? firstLine;
  const candidate = (clause.length >= 12 ? clause : firstLine).slice(0, 60).trim();
  if (!candidate) return 'New chat';
  if (candidate.length < 60) return candidate;

  // Cut at the last word boundary, unless that leaves a stub — a 60-character
  // single token (a URL, say) has no boundary to cut at, so cut mid-word and
  // stay inside the 60-character budget either way.
  const onWordBoundary = candidate.replace(/\s\S*$/, '').trimEnd();
  const usable = onWordBoundary.length >= 20 && onWordBoundary.length < candidate.length;
  return `${usable ? onWordBoundary : candidate.slice(0, 59).trimEnd()}…`;
}

// ──────────────────────  chat reply → post draft  ────────────────────────

/** Lines the model sometimes adds around a post, plus stray markdown. */
function cleanPostBody(raw: string): string {
  return raw
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

/**
 * Splits a written post into body and hashtags.
 *
 * Models put the tags on their own trailing line, and the publisher appends
 * `draft.hashtags` to `draft.body` when it composes the post. Extracting the
 * tags *without* removing that trailing block prints them twice — so the
 * block is lifted out of the body, and inline tags mid-sentence are left
 * exactly where the model wrote them.
 */
export function splitHashtags(text: string): { body: string; hashtags: string[] } {
  const lines = text.split('\n');
  const isTagLine = (line: string) =>
    line.trim().length > 0 && /^(#[\p{L}\p{N}_]{2,60}[\s,]*)+$/u.test(line.trim());

  let end = lines.length;
  const trailing: string[] = [];

  // Walk back over the trailing tag lines and any blank lines between them.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? '';
    if (line.trim() === '') {
      if (trailing.length === 0) end = i;
      continue;
    }
    if (!isTagLine(line)) break;
    trailing.unshift(line);
    end = i;
  }

  const tags = (trailing.join(' ').match(/#[\p{L}\p{N}_]{2,60}/gu) ?? []).map((t) => t.slice(1));

  return {
    body: lines.slice(0, end).join('\n').trimEnd(),
    hashtags: [...new Set(tags)].slice(0, 12),
  };
}

/**
 * Turns an assistant reply into a `ContentDraft` in NEEDS_REVIEW.
 *
 * It lands in the same review queue as pipeline-generated drafts, so a post
 * that started life in chat still cannot skip the approval screen.
 */
export async function draftFromMessage(args: {
  userId: string;
  messageId: string;
}): Promise<{ draftId: string } | null> {
  const { userId, messageId } = args;

  const message = await db.chatMessage.findFirst({
    where: { id: messageId, userId, role: 'ASSISTANT' },
    select: { id: true, content: true, conversationId: true, draftId: true },
  });
  if (!message) return null;

  if (message.draftId) {
    const existing = await db.contentDraft.findFirst({
      where: { id: message.draftId, userId },
      select: { id: true },
    });
    if (existing) return { draftId: existing.id };
  }

  const { body, hashtags } = splitHashtags(cleanPostBody(message.content));
  if (!body) return null;

  const draft = await db.contentDraft.create({
    data: {
      userId,
      origin: 'CHAT',
      conversationId: message.conversationId,
      format: 'ONE_INSIGHT',
      body,
      hashtags,
      status: 'NEEDS_REVIEW',
      // Chat drafts carry no paper, so there is nothing to fact-check against.
      // PENDING is honest: the approval screen says "unverified — you are the
      // check" rather than showing a green tick this draft has not earned.
      verificationStatus: 'PENDING',
    },
    select: { id: true },
  });

  await db.chatMessage.update({ where: { id: message.id }, data: { draftId: draft.id } });

  logger.info('Draft created from chat message', { userId, draftId: draft.id });
  return { draftId: draft.id };
}
