/**
 * POST /api/auth/signup — create an account.
 *
 * The only endpoint in the app that writes a `User` row. It provisions the
 * per-user records the rest of the product assumes exist (brand profile, a
 * default publishing schedule) inside one transaction, so a half-created
 * account cannot be signed into.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { hashPassword, validatePasswordStrength, PASSWORD_MAX_LENGTH } from '@/lib/password';
import { logger } from '@/lib/logger';

const SignupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.').max(PASSWORD_MAX_LENGTH),
  title: z.string().trim().max(160).optional(),
  timezone: z.string().trim().max(64).optional(),
});

/** A new account starts with three midweek morning slots rather than none. */
const DEFAULT_SLOTS = [
  { dayOfWeek: 2, timeOfDay: '09:00' },
  { dayOfWeek: 4, timeOfDay: '09:00' },
  { dayOfWeek: 6, timeOfDay: '10:00' },
];

export async function POST(req: NextRequest): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const parsed = SignupSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid signup details.' },
      { status: 400 },
    );
  }

  const { name, email, password, title, timezone } = parsed.data;

  const weak = validatePasswordStrength(password);
  if (weak) return NextResponse.json({ error: weak }, { status: 400 });

  const passwordHash = await hashPassword(password);

  try {
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          title: title ?? null,
          timezone: timezone && timezone.length > 0 ? timezone : 'UTC',
          approvalMode: 'APPROVAL_REQUIRED',
        },
        select: { id: true, email: true, name: true },
      });

      await tx.brandProfile.create({ data: { userId: created.id } });
      await tx.scheduleSlot.createMany({
        data: DEFAULT_SLOTS.map((slot) => ({ ...slot, userId: created.id })),
      });

      return created;
    });

    logger.info('Account created', { userId: user.id });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    // P2002 = unique constraint. Reported as a plain conflict; the signup form
    // is the one place where "this email is taken" is worth saying out loud,
    // because the alternative is a user who cannot tell why signup failed.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json(
        { error: 'An account with that email already exists. Try signing in.' },
        { status: 409 },
      );
    }
    logger.error('Signup failed', { err });
    return NextResponse.json({ error: 'Could not create the account.' }, { status: 500 });
  }
}
