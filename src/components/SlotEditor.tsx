'use client';

/**
 * The weekly publishing grid.
 *
 * Clicking a cell toggles a slot on or off for the signed-in user. Times are
 * stored as `"HH:MM"` strings and interpreted in that user's timezone by the
 * scheduler, which is why the zone is shown next to the grid rather than left
 * implicit.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The rows offered by default. A user's own times are merged in below. */
const DEFAULT_TIMES = ['08:00', '09:00', '12:00', '15:00', '17:00', '19:00'];

export interface Slot {
  id: string;
  dayOfWeek: number;
  timeOfDay: string;
}

export function SlotEditor({ slots, timezone }: { slots: Slot[]; timezone: string }) {
  const router = useRouter();
  const [current, setCurrent] = useState(slots);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A slot saved at a time the grid does not offer — seeded, or set before the
  // default rows changed — would otherwise be invisible *and* impossible to
  // turn off while still publishing posts. Its row is added instead.
  const times = useMemo(() => {
    const all = new Set([...DEFAULT_TIMES, ...current.map((slot) => slot.timeOfDay)]);
    return [...all].sort();
  }, [current]);

  function find(day: number, time: string): Slot | undefined {
    return current.find((slot) => slot.dayOfWeek === day && slot.timeOfDay === time);
  }

  async function toggle(day: number, time: string) {
    const key = `${day}-${time}`;
    const existing = find(day, time);
    setBusyKey(key);
    setError(null);

    try {
      if (existing) {
        const res = await fetch(`/api/schedule/slots?id=${existing.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
        setCurrent((prev) => prev.filter((slot) => slot.id !== existing.id));
      } else {
        const res = await fetch('/api/schedule/slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dayOfWeek: day, timeOfDay: time }),
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { slot: Slot };
        setCurrent((prev) => [...prev, data.slot]);
      }
      router.refresh();
    } catch {
      setError('That change did not save.');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="card">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink-900">Publishing slots</h2>
          <p className="mt-1 text-xs text-ink-500">
            Approved posts are placed in the next free slot. Times are in {timezone}.
          </p>
        </div>
        <span className="badge badge-clay">{current.length} active</span>
      </div>

      {error && (
        <p className="mb-4 rounded-2xl bg-rust-100 px-4 py-3 text-xs text-rust-500">{error}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-separate border-spacing-1.5">
          <thead>
            <tr>
              <th className="w-16" />
              {DAYS.map((day) => (
                <th
                  key={day}
                  className="pb-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-500"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {times.map((time) => (
              <tr key={time}>
                <th className="pr-2 text-right text-[0.7rem] font-medium text-ink-500">{time}</th>
                {DAYS.map((day, index) => {
                  const active = Boolean(find(index, time));
                  const key = `${index}-${time}`;
                  return (
                    <td key={day}>
                      <button
                        type="button"
                        onClick={() => void toggle(index, time)}
                        disabled={busyKey === key}
                        aria-pressed={active}
                        aria-label={`${DAYS[index]} ${time}`}
                        className={`h-9 w-full rounded-xl text-[0.7rem] font-semibold transition-colors ${
                          active
                            ? 'bg-clay-500 text-cream-50'
                            : 'bg-cream-50 text-ink-500 hover:bg-white'
                        } ${busyKey === key ? 'opacity-50' : ''}`}
                      >
                        {active ? '●' : ''}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
