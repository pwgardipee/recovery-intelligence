# Rose · Rosewood's state-aware concierge

A discreet, state-aware hospitality layer for Rosewood properties. Pre-arrival, in-stay, and post-stay choreography that adapts to the *state* a guest arrives in — without ever showing staff a single biometric number.

Built for the Hospitality 2030 hackathon at Rosewood Sand Hill, 16 May 2026.

---

## What it does in one breath

The guest connects a health signal (or just talks to us). Rose — the AI concierge inside the staff group chat — translates every signal into hospitality pacing, posts a rich arrival brief with do/don't directives, drafts daily rhythm messages that staff approve before sending, writes durable memory after the stay, and preloads that memory at every future Rosewood property under a different "sense of place."

Six surfaces:

1. **Pre-arrival connect screen** (`/stay/:id/connect`) — the guest's invitation to share a signal, with the auto-disconnect promise front and center.
2. **Staff group chat** (`/admin/stays/:id`, left pane) — Rose posts in the existing concierge thread alongside human staff. Rich cards for intake, identity merge, arrival brief, daily rhythm, delight moments, memory writes.
3. **Guest SMS thread** (`/admin/stays/:id`, right pane) — soft iMessage-style messages that only land after staff approval.
4. **Arrival brief card** — the synthesis moment. State, room prep, first offer, do/don't, sense-of-place anchoring.
5. **Approval gates** — every guest-facing message and every delight proposal is *pending* until staff taps Approve.
6. **Cross-property handoff** (Scene 9) — six months later the same guest's rhythm preloads at Rosewood Hong Kong with the sense of place re-skinned (oak grove → Bowen Road; valley honey → lychee honey).

---

## The demo (3 min)

Open the admin view for Maya's stay. The scene controller in the top bar steps through 10 beats — one click per beat, no typing during the demo.

| Scene | What lands on screen |
|------:|-----|
| 0 | Empty stay, just the header. |
| 1 | Maya replies to the 7-day email. Rose extracts the intake, **identity merge** card shows 3 profiles unified across properties. |
| 2 | She connects Whoop. **Consent strip** appears with auto-disconnect timestamp. Two pre-arrival signal snapshots seed in. |
| 3 | The 1-day-before AI call plays (audio + expandable transcript). |
| 4 | **Arrival brief generates** — the wow card. Anchored to Sand Hill's sense of place. |
| 5 | Day 2 morning, daily rhythm card drops with a **pending approval gate**. |
| 6 | Staff approves → soft SMS lands in Maya's iMessage thread. |
| 7 | Rose proposes a delight moment (anniversary dessert) — also pending approval. |
| 8 | Post-stay call plays; memory facts are extracted and written. |
| 9 | Cross-property handoff banner — open Hong Kong, her rhythm is preloaded with the sense of place re-skinned. |

The closing line: *"Same rhythm. Different sense of place."*

---

## Run it locally

1. **Database** — Neon Postgres connection string in `.env.local`:
   ```
   DATABASE_URL="postgresql://...?sslmode=require"
   ```
2. **Push schema:**
   ```
   npm run db:push
   ```
3. **Anthropic key** (optional but recommended — drives live synthesis):
   ```
   ANTHROPIC_API_KEY="sk-ant-..."
   ```
   Without it, curated fallback content renders so the demo still flows.
4. **Start:**
   ```
   npm run dev
   ```
5. **Seed:**
   ```
   curl -X POST http://localhost:3000/api/seed
   ```
6. **Open** `http://localhost:3000`, click *Open concierge thread* on Maya's row.

---

## Architecture in one diagram

```
                                         ┌──────────────────────────────┐
   guest signals (Whoop) ─────►  signals │  hospitality firewall        │
   pre-arrival email   ─────►  intake    │  translateSignalsToHospitality│
   1-day AI call       ─────►  intake    │  (numbers never leave here)  │
                                         └─────────────┬────────────────┘
                                                       ▼
                                    ┌──────────────────────────────┐
                                    │  Claude prompts              │
                                    │  • interpretIntake           │
                                    │  • generateArrivalBrief      │
                                    │  • generateDailyRose       │
                                    │  • extractMemory             │
                                    └─────────────┬────────────────┘
                                                  ▼
                       ┌──────────────────────────────────────────────┐
                       │  messages table — kind-tagged rich payloads  │
                       └──────┬──────────────────────────┬────────────┘
                              ▼                          ▼
                       staff group thread          guest SMS thread
                       (rich cards, approvals)     (only approved text)
                                                  
                       memory_facts persist across stays
                       → preloaded at next Rosewood property
```

Eight tables: `properties`, `guests`, `stays`, `intake_answers`, `consent_records`, `signals`, `messages`, `memory_facts`. The Whoop tables from the existing scaffold are untouched.

---

## The four invariants we never break

1. **No metrics, ever.** Forbidden vocabulary is enforced in every system prompt and the `translateSignalsToHospitality` firewall pre-translates before Claude sees anything. Outputs use only `energy / pacing / softer morning / restoration`.
2. **Consent visible at all times.** The consent chip in the admin header shows source + auto-disconnect timestamp. The connect screen promises auto-disconnect on the very first card the guest sees.
3. **Copilot, not autopilot.** Every guest-facing message and every delight moment is `approval_status: "pending"` until staff taps Approve. Auto-actions (room temp, scent stage) are clearly marked separately.
4. **Sense of place reskinning.** Each property's `senseOfPlace` jsonb dictates the amenities, scent, soundtrack, ritual pairings, and dining signatures. The same guest at Sand Hill vs. Hong Kong gets the same *rhythm*, anchored in different *place*.

---

## What's plugged in vs. faked

| | Status |
|--|--|
| Drizzle + Neon schema | **Real** (`lib/db/rhythm-schema.ts`) |
| Anthropic API for the 4 prompts | **Real** when `ANTHROPIC_API_KEY` is set — curated fallback otherwise |
| Whoop OAuth callback | Stubbed (pre-existing scaffold) — mock signals seeded for demo |
| Pre-arrival + post-stay call audio | Static MP3 in `/public/audio` — **see ElevenLabs section below** |
| Staff group text (real-world Rosewood ops) | Modeled as the admin staff thread; we say in the pitch that production routes to their existing group text |
| Email send | Modeled as Scene 1; we say in the pitch we attach a one-line link to Rosewood's existing 7-day email |

---

## ElevenLabs — what to do next (after you've finished coding)

The demo currently expects two MP3s in `/public/audio/`:

- `/public/audio/pre-arrival.mp3` — the 1-day-before call from Rose
- `/public/audio/post-stay.mp3` — the follow-up after checkout

You can generate both in ~10 minutes:

### Step 1 — Pick a voice
1. Go to [elevenlabs.io/app/voice-library](https://elevenlabs.io/app/voice-library).
2. Filter: Female, English, **age 35–50, gentle/warm, mid-low register**. Avoid bright/upbeat voices.
3. Suggested matches to audition (preview each):
   - **Alice** (warm, hospitality-feeling)
   - **Sarah** (calm professional)
   - **Lily** (low, soft)
   - **Charlotte** (continental neutral, slightly British — strongest "Rosewood" feel)
4. Click *Add to voices* on your favourite.

### Step 2 — Generate the pre-arrival call
1. Open *Studio → Text to Speech*.
2. Voice: your chosen one (e.g., Charlotte).
3. Model: **Eleven Multilingual v2** (most natural).
4. Settings: Stability 0.55, Similarity 0.75, Style 0.10, Speaker Boost ON.
5. Paste **only Rose's lines** (use ellipses and commas to slow her down):

   ```
   Hi Maya — this is Rose, calling on behalf of Rosewood Sand Hill ahead of tomorrow. A quick minute?
   
   ...
   
   Lovely. I see the red-eye in at 7:42. Would you like a slower evening tomorrow, or stay open?
   
   ...
   
   Held. We'll keep check-in concise and put a light dinner option in your room. Any change on the wine tasting?
   
   ...
   
   Done. One last thing — any scent that has worked before?
   
   ...
   
   We have it. We'll have it waiting. Travel safe.
   ```

   *Why ellipses?* They simulate Maya's responses without you having to record a second voice. The pauses give your audience time to read the on-screen transcript.

6. Click *Generate*. Download as MP3.
7. Save to `/public/audio/pre-arrival.mp3`.

### Step 3 — Generate the post-stay call
Same voice, same settings. Use Rose's lines from the post-stay transcript in `lib/rhythm/scenes.ts → runScene8PostStayMemory` (the `transcript` variable). Save to `/public/audio/post-stay.mp3`.

### Step 4 — Optional: Maya's voice for higher production value
If you have ~5 more minutes, generate Maya's lines with a **different female voice** (try *Aria* or *Jessica*), then mix the two tracks in any free audio editor (Audacity, GarageBand). Export the combined call as the same filename. The pause-based version above also works.

### Step 5 — If something feels off
Common fixes:
- Voice feels too upbeat → lower **Stability** to 0.40 or pick a lower-register voice.
- Sentences run together → add ` ... ` between phrases.
- Rosewood line sounds robotic → switch model to **Eleven v3 (Alpha)** if your account has access; otherwise increase **Similarity** to 0.85.

### Step 6 — (Stretch) Live conversational agent
If you have time to spare and want to upgrade to a *live* call instead of pre-recorded:

1. ElevenLabs *Agents* → Create new agent.
2. System prompt: paste the `HOUSE_RULES` from `lib/ai/prompts.ts` plus a short version of the 4 intake questions.
3. Voice: same as above.
4. Test the agent in the playground first — it should ask the four questions and gracefully end the call.
5. Embed the agent ID in a new client component and trigger it on Scene 3 instead of `<audio>`.

**My recommendation: stick with the pre-recorded MP3 for the live demo.** A pre-recorded MP3 cannot fail on stage. The conversational agent is a higher-risk wow.

---

## Files I created today (the "built during the hackathon" answer for the judges)

- `lib/db/rhythm-schema.ts` — 8 tables for the Rose domain
- `lib/ai/anthropic.ts`, `lib/ai/prompts.ts` — Claude client + 4 prompts with the hospitality firewall
- `lib/rhythm/scenes.ts` — 10-beat deterministic scene engine
- `app/api/scene/route.ts` — advance / reset / jump
- `app/api/messages/[id]/approve/route.ts` — approval gate
- `app/api/seed/route.ts` — idempotent demo seed
- `app/page.tsx` — landing
- `app/stay/[id]/connect/page.tsx`, `app/stay/[id]/connect/connect-options.tsx` — guest pre-arrival screen
- `app/admin/stays/[id]/page.tsx`, `message-renderer.tsx`, `scene-control.tsx` — the demo's main screen
- `app/globals.css`, `app/layout.tsx` — Rosewood design system

The Whoop OAuth scaffolding (`app/auth/whoop/...`, `lib/whoop/...`) was the starting commit and is left untouched — we mock the signal stream for the demo to stay deterministic.
