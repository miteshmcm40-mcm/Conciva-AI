# MCP tools to add on `dashboard.9278.io`

This spec is the contract between this portal (`voice.9278.io`) and the
dashboard MCP server. Add these three tools to the MCP extension that already
hosts `schedule_meeting` / `get_scheduled_meetings` / `create_scheduled_meeting`.

Once these land, the agent-prompt mitigation we pushed to every agent
(`<!-- meeting-reschedule-policy-v1 -->`) can be replaced with proper
`update_scheduled_meeting(...)` calls — no more double bookings.

---

## 1. `update_scheduled_meeting`

Update one or more fields on an existing booking and re-sync to the n8n →
Google Calendar workflow so the calendar event moves with it.

### Python (LiveKit MCP / fastmcp style)

```python
@mcp.tool()
async def update_scheduled_meeting(
    meeting_id: str,
    start: str | None = None,                # ISO 8601 with timezone
    end: str | None = None,                  # optional; if omitted and start moves, recompute = start + duration_minutes
    duration_minutes: int | None = None,
    name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    notes: str | None = None,
    status: str | None = None,               # "scheduled" | "cancelled" | "completed"
) -> dict:
    """Update an existing meeting (time / contact / notes / status).

    Only fields that are NOT None are updated — partial updates are normal.
    On success:
      - The Redis/DB record is updated atomically.
      - If start/end/duration_minutes/status changed, an "update" event
        is pushed to n8n so Google Calendar moves the event too.
      - Returns the SAME shape as `create_scheduled_meeting`.

    Errors:
      - 404 if meeting_id doesn't exist.
      - 400 if start is unparseable or status is unknown.

    Idempotent: calling with the same field values is a no-op (no extra
    n8n event fired).
    """
    record = redis.hgetall(f"livekit:scheduled_meeting:{meeting_id}")
    if not record:
        return {"success": False, "error": "Meeting not found", "meeting_id": meeting_id}

    # Build the patch — only fields that actually changed.
    patch = {}
    if start         is not None: patch["start"]            = parse_iso(start)
    if end           is not None: patch["end"]              = parse_iso(end)
    if duration_minutes is not None: patch["duration_minutes"] = int(duration_minutes)
    if name          is not None: patch["name"]             = name.strip()
    if email         is not None: patch["email"]            = email.strip().lower()
    if phone         is not None: patch["phone"]            = phone.strip()
    if notes         is not None: patch["notes"]            = notes
    if status        is not None:
        if status not in ("scheduled", "cancelled", "completed"):
            return {"success": False, "error": f"Unknown status '{status}'"}
        patch["status"] = status

    # If start changed and duration_minutes wasn't passed, recompute end so
    # the call site doesn't have to do the math.
    if "start" in patch and "end" not in patch:
        dur = patch.get("duration_minutes") or int(record.get("duration_minutes", 30))
        patch["end"] = patch["start"] + timedelta(minutes=dur)

    # Detect no-op.
    if all(record.get(k) == v for k, v in patch.items()):
        return {"success": True, "noop": True, "meeting": _shape(record)}

    record.update(patch)
    record["updated_at"] = datetime.utcnow().isoformat()
    redis.hmset(f"livekit:scheduled_meeting:{meeting_id}", record)

    # If time / status moved, sync to n8n. Same webhook shape as create,
    # but with a discriminator field.
    calendar_synced = False
    if {"start", "end", "status"} & patch.keys():
        try:
            r = await httpx.post(
                N8N_WEBHOOK_URL,
                json={
                    "event":   "meeting.updated",
                    "meeting": _shape(record),
                    "changed": list(patch.keys()),
                },
                timeout=10.0,
            )
            calendar_synced = r.status_code < 400
        except Exception as e:
            log.warning("n8n update sync failed: %s", e)

    return {
        "success": True,
        "calendar_synced": calendar_synced,
        "meeting": _shape(record),
    }
```

### Tool schema (for the agent to discover)

```json
{
  "name": "update_scheduled_meeting",
  "description": "Update an existing scheduled meeting (time, contact, notes, or status). Use this when a caller asks to RESCHEDULE — never call schedule_meeting again. Returns the updated meeting; the Google Calendar event is moved automatically.",
  "input_schema": {
    "type": "object",
    "required": ["meeting_id"],
    "properties": {
      "meeting_id":       {"type": "string",  "description": "ID returned by schedule_meeting or get_call_meeting."},
      "start":            {"type": "string",  "description": "New start time, ISO 8601 with timezone (e.g. 2026-06-12T15:00:00+05:30)."},
      "end":              {"type": "string",  "description": "Optional new end time. Auto-computed from start + duration_minutes if omitted."},
      "duration_minutes": {"type": "integer", "description": "Override duration; defaults to existing value."},
      "name":             {"type": "string"},
      "email":            {"type": "string"},
      "phone":            {"type": "string"},
      "notes":            {"type": "string"},
      "status":           {"type": "string",  "enum": ["scheduled", "cancelled", "completed"]}
    }
  }
}
```

---

## 2. `cancel_scheduled_meeting`

Shortcut for the status-only update — semantically clearer for the agent.

```python
@mcp.tool()
async def cancel_scheduled_meeting(meeting_id: str, reason: str | None = None) -> dict:
    """Cancel a scheduled meeting and remove the Google Calendar event.

    Internally equivalent to update_scheduled_meeting(meeting_id, status='cancelled'),
    but the agent finds this more discoverable when a caller says
    "actually cancel that meeting".
    """
    return await update_scheduled_meeting(
        meeting_id=meeting_id,
        status="cancelled",
        notes=(f"Cancelled via agent. Reason: {reason}" if reason else "Cancelled via agent."),
    )
```

Tool schema:

```json
{
  "name": "cancel_scheduled_meeting",
  "description": "Cancel an existing scheduled meeting and remove its Google Calendar event. Use when a caller explicitly says they want to cancel — not for reschedules (use update_scheduled_meeting with a new start instead).",
  "input_schema": {
    "type": "object",
    "required": ["meeting_id"],
    "properties": {
      "meeting_id": {"type": "string"},
      "reason":     {"type": "string"}
    }
  }
}
```

---

## 3. n8n workflow updates

The n8n flow that consumes `POST /n8n/meeting-created` already knows how to
add events. Extend it to handle two more events:

| event             | payload                                                                 | n8n action |
|-------------------|-------------------------------------------------------------------------|------------|
| `meeting.created` | (existing — unchanged)                                                  | Insert calendar event, attach `calendar_event_id` back via webhook reply |
| `meeting.updated` | `{ event, meeting, changed: [keys...] }`                                | If `changed` contains `start`/`end`/`status`, **patch** the existing GCal event using its `meeting.calendar_event_id`. If `status == "cancelled"`, **delete** the event. |
| `meeting.cancelled` (optional alias) | `{ event, meeting }`                                       | Delete event. |

Google Calendar `events.patch` and `events.delete` are both single-call APIs;
n8n has dedicated nodes for both. Patch path:

```
PATCH /calendar/v3/calendars/{calendarId}/events/{calendar_event_id}
{
  "start": { "dateTime": "2026-06-12T15:00:00+05:30" },
  "end":   { "dateTime": "2026-06-12T15:30:00+05:30" }
}
```

---

## 4. Migration / rollout order

1. Land `update_scheduled_meeting` + `cancel_scheduled_meeting` on
   `dashboard.9278.io`. Restart the MCP server.
2. Verify `list_tools()` from this portal shows them.
3. Extend n8n to handle `meeting.updated` and `meeting.cancelled`. Test by
   calling the new MCP tools and watching the GCal event move/disappear.
4. Once stable, **swap the agent-prompt fragment**
   (`<!-- meeting-reschedule-policy-v1 -->`) for a v2 that says: *"If the
   caller wants to change the time, call `update_scheduled_meeting` with the
   meeting_id from your last `schedule_meeting` call."* This is a small
   patch to `_patch_prompts.mjs` — bump the marker to v2 and re-run.

---

## 5. Sanity tests (run after the dashboard team deploys)

From this repo, run `node` against the MCP client:

```js
import { callTool } from './server/mcp.js';

// 1. Create a throwaway test meeting.
const created = unwrap(await callTool('create_scheduled_meeting', {
  name: 'TEST', email: 'test@example.com', phone: '+910000000000',
  start: '2030-01-01T10:00:00+05:30', duration_minutes: 30,
  call_id: 'test-' + Date.now(), source: 'test',
}));
const id = created.meeting.id;

// 2. Update the time.
const updated = unwrap(await callTool('update_scheduled_meeting', {
  meeting_id: id,
  start: '2030-01-01T15:00:00+05:30',
}));
// Expect: meeting.start === 15:00, end === 15:30, calendar_synced === true.

// 3. Cancel.
const cancelled = unwrap(await callTool('cancel_scheduled_meeting', {
  meeting_id: id, reason: 'sanity test',
}));
// Expect: meeting.status === 'cancelled', calendar event deleted on GCal.
```

A clean run on those three calls = the rescheduling flow is wired
end-to-end.
