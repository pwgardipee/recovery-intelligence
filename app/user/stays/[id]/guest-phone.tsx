"use client";

import { GuestThread, type RenderedMessage } from "@/app/admin/stays/[id]/message-renderer";

/**
 * The guest's phone view during/after the stay. Wraps the existing
 * GuestThread component in an iMessage-feeling frame so the demo audience
 * reads it as "Maya's actual phone."
 */
export function GuestPhone({
  messages,
  guestName,
  propertyName,
}: {
  messages: RenderedMessage[];
  guestName: string;
  propertyName: string;
}) {
  return (
    <div className="mx-auto mt-8 max-w-md px-4 pb-10">
      <div className="rw-card overflow-hidden rounded-[28px]">
        {/* Phone "speaker" line */}
        <div className="flex items-center justify-center bg-paper py-2">
          <span className="h-1 w-12 rounded-full bg-line" />
        </div>
        <div className="bg-paper">
          <GuestThread
            messages={messages}
            guestName={guestName}
            propertyName={propertyName}
          />
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] uppercase tracking-[0.32em] text-ink-muted">
        Guest view · {guestName}&rsquo;s phone
      </p>
    </div>
  );
}
