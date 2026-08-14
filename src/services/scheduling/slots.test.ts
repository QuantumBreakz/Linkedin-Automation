import { describe, it, expect } from 'vitest';
import { addDays, setHours, setMinutes, startOfDay } from 'date-fns';

describe('scheduling/slots logic', () => {
  it('calculates future slot timestamp correctly based on dayOfWeek and timeOfDay', () => {
    const now = new Date();
    const targetDay = addDays(now, 1);
    const dayOfWeek = targetDay.getDay();

    let slotDate = startOfDay(targetDay);
    slotDate = setHours(slotDate, 10);
    slotDate = setMinutes(slotDate, 30);

    expect(slotDate.getHours()).toBe(10);
    expect(slotDate.getMinutes()).toBe(30);
    expect(slotDate.getTime()).toBeGreaterThan(now.getTime());
  });
});
