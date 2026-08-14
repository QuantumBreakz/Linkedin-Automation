/**
 * Publishing slot assignment and scheduling service.
 *
 * Implements docs/02 §Scheduling and weekly slot allocation.
 * Assigns approved drafts to the user's next open ScheduleSlot in their timezone.
 */

import { addDays, setHours, setMinutes, isAfter, startOfDay } from 'date-fns';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface NextSlotResult {
  scheduledFor: Date;
  slotId: string;
}

/**
 * Finds the next open publishing slot for a user, avoiding collisions with already-scheduled drafts.
 */
export async function findNextAvailableSlot(
  userId: string,
  fromDate: Date = new Date(),
): Promise<NextSlotResult | null> {
  const [user, slots, existingScheduled] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    }),
    db.scheduleSlot.findMany({
      where: { userId, active: true },
      orderBy: [{ dayOfWeek: 'asc' }, { timeOfDay: 'asc' }],
    }),
    db.contentDraft.findMany({
      where: {
        userId,
        status: 'SCHEDULED',
        scheduledFor: { gte: fromDate },
      },
      select: { scheduledFor: true },
    }),
  ]);

  if (slots.length === 0) {
    // Default fallback: scheduled for 24 hours from now if no slots configured
    return null;
  }

  const occupiedTimes = new Set(
    existingScheduled
      .map((d) => d.scheduledFor?.getTime())
      .filter((t): t is number => t !== undefined),
  );

  // Search forward up to 4 weeks (28 days) for the next free slot
  for (let dayOffset = 0; dayOffset < 28; dayOffset++) {
    const candidateDay = addDays(fromDate, dayOffset);
    const dayOfWeek = candidateDay.getDay(); // 0 = Sunday

    const matchingSlots = slots.filter((s) => s.dayOfWeek === dayOfWeek);

    for (const slot of matchingSlots) {
      const [hourStr, minStr] = slot.timeOfDay.split(':');
      const hour = Number(hourStr ?? 9);
      const minute = Number(minStr ?? 0);

      let slotDate = startOfDay(candidateDay);
      slotDate = setHours(slotDate, hour);
      slotDate = setMinutes(slotDate, minute);

      // Must be in the future
      if (isAfter(slotDate, fromDate)) {
        const timeKey = slotDate.getTime();
        if (!occupiedTimes.has(timeKey)) {
          return {
            scheduledFor: slotDate,
            slotId: slot.id,
          };
        }
      }
    }
  }

  logger.warn('No available schedule slot found in the next 28 days', { userId });
  return null;
}

/**
 * Assigns an approved draft to the next available schedule slot.
 */
export async function scheduleDraftToNextSlot(draftId: string, userId: string): Promise<Date> {
  const nextSlot = await findNextAvailableSlot(userId);
  const scheduledFor = nextSlot?.scheduledFor ?? addDays(new Date(), 1);

  await db.contentDraft.update({
    where: { id: draftId },
    data: {
      status: 'SCHEDULED',
      scheduledFor,
    },
  });

  logger.info('Assigned draft to publishing slot', { draftId, scheduledFor });
  return scheduledFor;
}
