# Cross-Brain Messaging

Send and receive messages between Claude Code sessions running in different repos.

## When to Use

- You discover a bug that **another service** needs to fix
- You need to ask another service about its **API capabilities**
- You've deployed a fix that **another service** should verify
- You've learned a pattern that **all brains** should know

## Quick Reference

```bash
# Check your inbox (auto-detects agent from cwd)
bun .claude/skills/cross-brain-message/brain-msg.ts inbox

# Check with verbose output
bun .claude/skills/cross-brain-message/brain-msg.ts inbox -v

# Send a WORK ORDER (RECOMMENDED — writes to CLAUDE.md + inbox + MEMORY.md)
bun .claude/skills/cross-brain-message/brain-msg.ts work-order \
  --to <agent-id> \
  --subject "Fix 3 P0 bugs" \
  --body '{"message":"Details here","action":"read memory/PLAN.md","file":"memory/PLAN.md"}'

# Send a simple message (inbox only — brain must actively check)
bun .claude/skills/cross-brain-message/brain-msg.ts send \
  --to <agent-id> \
  --type <message-type> \
  --subject "Short description" \
  --body '{"key": "value"}'

# Acknowledge a message (moves to archive)
bun .claude/skills/cross-brain-message/brain-msg.ts ack <message-id>

# List all registered agents
bun .claude/skills/cross-brain-message/brain-msg.ts agents

# Show message types
bun .claude/skills/cross-brain-message/brain-msg.ts types
```

## Session Protocol

### At Session Start
1. Check your inbox: `bun .claude/skills/cross-brain-message/brain-msg.ts inbox`
2. Process any pending messages before starting new work
3. Acknowledge messages after handling them

### When You Discover Cross-Service Issues
Send a message immediately. Don't wait for the user to relay it.

Example - the scenario that motivated this skill:
```bash
# mech-storage discovers teleportation has duplicate events
bun .claude/skills/cross-brain-message/brain-msg.ts send \
  --to teleportation-gm \
  --type bug_report \
  --subject "Duplicate events in timeline_events (6.8GB, 74% dupes)" \
  --body '{
    "symptoms": [
      "timeline_events table is 6.8GB (90% of database)",
      "23-74% duplicate rows per session",
      "Database running out of disk space",
      "Slow queries causing 10x machine autoscaling"
    ],
    "root_cause": "Timestamp mismatch: stop hook uses Date.now() server-side instead of original transcript timestamps, making dedup filter ineffective",
    "impact": "Database disk space exhaustion, 10x autoscaling costs",
    "fixes_needed": [
      "Use original event timestamp, not Date.now()",
      "Add deterministic event IDs (hash of session_id + event_index)",
      "Save cursor AFTER successful upload, not before",
      "Add ON CONFLICT DO NOTHING for server-side dedup"
    ],
    "api_capabilities": {
      "ON_CONFLICT": true,
      "raw_sql_query": true,
      "endpoint": "/api/apps/{appId}/postgresql/query"
    }
  }'
```

### When You Deploy a Fix
```bash
bun .claude/skills/cross-brain-message/brain-msg.ts send \
  --to mech-storage-001 \
  --type fix_deployed \
  --correlation-id <original-message-id> \
  --subject "Fixed duplicate events in teleportation" \
  --body '{
    "issue": "Duplicate timeline events",
    "fix_description": "Use original timestamps + deterministic IDs + ON CONFLICT",
    "files_changed": [
      ".claude/hooks/stop.mjs",
      "relay/server.js",
      "relay/lib/timeline-service.js"
    ],
    "verification_steps": [
      "Monitor timeline_events table size over 24 hours",
      "Check duplicate rate drops to <1%",
      "Verify no new disk space warnings"
    ]
  }'
```

### When You Need API Info
```bash
bun .claude/skills/cross-brain-message/brain-msg.ts send \
  --to mech-storage-001 \
  --type api_capability_query \
  --subject "Does mech-storage support ON CONFLICT?" \
  --body '{
    "questions": [
      "Does the /postgresql/query endpoint support INSERT ... ON CONFLICT DO NOTHING?",
      "Is there a batch insert endpoint with dedup support?",
      "What is the max query size for raw SQL?"
    ]
  }'
```

## Message Types

| Type | Use When |
|------|----------|
| `bug_report` | You find a bug affecting another service |
| `fix_request` | You need another service to make a change |
| `fix_deployed` | You've fixed something another service reported |
| `api_capability_query` | You need to know what another service supports |
| `api_capability_response` | Answering a capability question |
| `knowledge_share` | You discovered a pattern all brains should know |
| `notification` | General information sharing |

## Registered Agents

| Agent ID | Repo | Capabilities |
|----------|------|-------------|
| `decisive-gm` | decisive_redux | Portfolio management, financial admin |
| `teleportation-gm` | teleportation-private | Code approval, hooks, timeline events |
| `mech-storage-001` | mech/mech-storage | PostgreSQL, NoSQL, file storage |
| `mech-browse-001` | mech/mech-browse | Browser automation, web scraping |
| `mech-llms-001` | mech/mech-llms | LLM API, audio transcription |

Register new agents:
```bash
bun .claude/skills/cross-brain-message/brain-msg.ts register \
  --agent <agent-id> \
  --repo /Users/kefentse/dev_env/<repo-path> \
  --capabilities "cap1,cap2,cap3"
```

## Architecture

```
~/.claude/brain-inbox/
  _registry.json              # All registered agents
  decisive-gm/               # Decisive's inbox
    msg-1234567890-abc.json   # Pending message
    _acked/                   # Archived messages
      msg-9876543210-xyz.json
  teleportation-gm/           # Teleportation's inbox
  mech-storage-001/            # Mech Storage's inbox
```

Messages are JSON files with standard envelope:
```json
{
  "id": "msg-1234567890-abc123",
  "version": "1.0",
  "type": "bug_report",
  "from": "mech-storage-001",
  "to": "teleportation-gm",
  "subject": "Duplicate events in timeline_events",
  "body": { ... },
  "timestamp": "2026-02-07T12:00:00.000Z",
  "ttl_hours": 72
}
```

## Future: ADMP Upgrade Path

When brains are deployed to Fly.io, this skill will add ADMP transport:
- Messages also sent via AgentDispatch hub (agentdispatch.fly.dev)
- File-based inbox remains as local fallback
- Webhook delivery for real-time notifications
- Ed25519 message signing for trust verification
