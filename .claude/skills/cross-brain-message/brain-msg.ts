#!/usr/bin/env bun
/**
 * Cross-Brain Messaging CLI
 *
 * Enables Claude Code sessions to send messages to each other via a shared
 * file-based inbox. Each project has an agent ID, and messages are stored
 * as JSON files in ~/.claude/brain-inbox/{agent-id}/
 *
 * Usage:
 *   bun brain-msg.ts send --to <agent> --type <type> --subject <subject> --body <json>
 *   bun brain-msg.ts inbox [--agent <agent>]
 *   bun brain-msg.ts ack <message-id> [--agent <agent>]
 *   bun brain-msg.ts agents
 *   bun brain-msg.ts register --agent <agent> --repo <repo-path> [--capabilities <cap1,cap2>]
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

// === Configuration ===

const INBOX_ROOT = join(homedir(), '.claude', 'brain-inbox');
const REGISTRY_FILE = join(INBOX_ROOT, '_registry.json');
const ACK_DIR = '_acked';

// === Types ===

interface BrainMessage {
  id: string;
  version: '1.0';
  type: string;
  from: string;
  to: string;
  subject: string;
  body: any;
  timestamp: string;
  correlation_id?: string;
  ttl_hours: number;
}

interface AgentRegistration {
  agent_id: string;
  repo: string;
  capabilities: string[];
  registered_at: string;
  last_seen?: string;
}

interface Registry {
  agents: Record<string, AgentRegistration>;
}

// === Message Types ===

const MESSAGE_TYPES = {
  // Cross-service bug reports
  bug_report: {
    description: 'Report a bug found that affects another service',
    body_schema: {
      symptoms: 'string[]',
      root_cause: 'string',
      impact: 'string',
      fixes_needed: 'string[]',
      api_capabilities: 'Record<string, boolean>  // what the reporting service supports',
    }
  },
  // Request another service to fix something
  fix_request: {
    description: 'Request a fix from another service',
    body_schema: {
      issue: 'string',
      suggested_fix: 'string',
      priority: 'low | medium | high | critical',
      context: 'any',
    }
  },
  // Confirm a fix was deployed
  fix_deployed: {
    description: 'Notify that a fix has been deployed',
    body_schema: {
      issue: 'string',
      fix_description: 'string',
      files_changed: 'string[]',
      verification_steps: 'string[]',
    }
  },
  // Query API capabilities
  api_capability_query: {
    description: 'Ask another service what it supports',
    body_schema: {
      questions: 'string[]  // e.g., "Does mech-storage support ON CONFLICT?"',
    }
  },
  // Response to capability query
  api_capability_response: {
    description: 'Respond with API capabilities',
    body_schema: {
      answers: 'Record<string, { supported: boolean, details: string }>',
    }
  },
  // Share a learning/pattern
  knowledge_share: {
    description: 'Share a pattern or learning with other brains',
    body_schema: {
      pattern_type: 'error | success | optimization',
      description: 'string',
      evidence: 'string',
      recommendation: 'string',
    }
  },
  // General notification
  notification: {
    description: 'General notification between brains',
    body_schema: {
      message: 'string',
      metadata: 'any',
    }
  },
  // Work order (writes to all discovery paths)
  work_order: {
    description: 'Assign work to another brain. Writes to CLAUDE.md + inbox + MEMORY.md so it cannot be missed.',
    body_schema: {
      message: 'string',
      priority: 'low | medium | high | critical',
      action: 'string  // e.g., "read memory/SELF_IMPROVEMENT_PLAN.md"',
      file: 'string?  // optional file path relative to repo root to reference',
    }
  },
};

// === Helpers ===

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadRegistry(): Registry {
  if (!existsSync(REGISTRY_FILE)) {
    return { agents: {} };
  }
  return JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
}

function saveRegistry(registry: Registry) {
  ensureDir(INBOX_ROOT);
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

function getAgentInbox(agentId: string): string {
  const dir = join(INBOX_ROOT, agentId);
  ensureDir(dir);
  return dir;
}

function generateId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function detectAgent(): string | null {
  // Try to detect agent from current working directory
  const cwd = process.cwd();
  const registry = loadRegistry();

  for (const [id, agent] of Object.entries(registry.agents)) {
    if (cwd.startsWith(agent.repo)) {
      return id;
    }
  }
  return null;
}

// === Commands ===

function cmdSend(args: string[]) {
  let to = '', type = 'notification', subject = '', bodyStr = '{}', from = '';
  let correlationId = '';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--to': to = args[++i]; break;
      case '--type': type = args[++i]; break;
      case '--subject': subject = args[++i]; break;
      case '--body': bodyStr = args[++i]; break;
      case '--from': from = args[++i]; break;
      case '--correlation-id': correlationId = args[++i]; break;
    }
  }

  if (!from) {
    from = detectAgent() || 'unknown';
  }

  if (!to) {
    console.error('Error: --to is required');
    console.error('Available agents:');
    const registry = loadRegistry();
    for (const [id, agent] of Object.entries(registry.agents)) {
      console.error(`  ${id} (${agent.repo})`);
    }
    process.exit(1);
  }

  if (!subject) {
    console.error('Error: --subject is required');
    process.exit(1);
  }

  let body: any;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    // If not valid JSON, wrap as a message string
    body = { message: bodyStr };
  }

  const message: BrainMessage = {
    id: generateId(),
    version: '1.0',
    type,
    from,
    to,
    subject,
    body,
    timestamp: new Date().toISOString(),
    ttl_hours: 72,
  };

  if (correlationId) {
    message.correlation_id = correlationId;
  }

  const inboxDir = getAgentInbox(to);
  const filename = `${message.id}.json`;
  writeFileSync(join(inboxDir, filename), JSON.stringify(message, null, 2));

  console.log(`Message sent to ${to}: ${subject}`);
  console.log(`  ID: ${message.id}`);
  console.log(`  Type: ${type}`);
  console.log(`  File: ${join(inboxDir, filename)}`);
}

function cmdInbox(args: string[]) {
  let agentId = '';
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--agent': agentId = args[++i]; break;
      case '-v': case '--verbose': verbose = true; break;
    }
  }

  if (!agentId) {
    agentId = detectAgent() || '';
  }

  if (!agentId) {
    console.error('Error: Could not detect agent. Use --agent <id> or register this repo.');
    process.exit(1);
  }

  const inboxDir = getAgentInbox(agentId);
  const files = readdirSync(inboxDir).filter(f => f.endsWith('.json') && !f.startsWith('_'));

  if (files.length === 0) {
    console.log(`Inbox for ${agentId}: empty`);
    return;
  }

  console.log(`Inbox for ${agentId}: ${files.length} message(s)\n`);

  // Filter expired messages
  const now = Date.now();
  const messages: BrainMessage[] = [];

  for (const file of files) {
    const msg: BrainMessage = JSON.parse(readFileSync(join(inboxDir, file), 'utf-8'));
    const msgTime = new Date(msg.timestamp).getTime();
    const ttlMs = (msg.ttl_hours || 72) * 60 * 60 * 1000;

    if (now - msgTime > ttlMs) {
      // Expired - move to acked
      const ackDir = join(inboxDir, ACK_DIR);
      ensureDir(ackDir);
      const content = readFileSync(join(inboxDir, file), 'utf-8');
      writeFileSync(join(ackDir, file), content);
      unlinkSync(join(inboxDir, file));
      continue;
    }

    messages.push(msg);
  }

  // Sort by timestamp (newest first)
  messages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  for (const msg of messages) {
    const age = getAge(msg.timestamp);
    console.log(`--- [${msg.type}] ${msg.subject} ---`);
    console.log(`  From: ${msg.from} | ${age} ago`);
    console.log(`  ID: ${msg.id}`);

    if (msg.correlation_id) {
      console.log(`  Correlation: ${msg.correlation_id}`);
    }

    if (verbose) {
      console.log(`  Body: ${JSON.stringify(msg.body, null, 4)}`);
    } else {
      // Show a summary of the body
      const bodyStr = JSON.stringify(msg.body);
      if (bodyStr.length > 200) {
        console.log(`  Body: ${bodyStr.slice(0, 200)}...`);
      } else {
        console.log(`  Body: ${bodyStr}`);
      }
    }
    console.log('');
  }
}

function cmdAck(args: string[]) {
  let messageId = args[0];
  let agentId = '';

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--agent') agentId = args[++i];
  }

  if (!agentId) {
    agentId = detectAgent() || '';
  }

  if (!messageId || !agentId) {
    console.error('Usage: brain-msg ack <message-id> [--agent <agent>]');
    process.exit(1);
  }

  const inboxDir = getAgentInbox(agentId);
  const filename = `${messageId}.json`;
  const filepath = join(inboxDir, filename);

  if (!existsSync(filepath)) {
    console.error(`Message ${messageId} not found in ${agentId}'s inbox`);
    process.exit(1);
  }

  const ackDir = join(inboxDir, ACK_DIR);
  ensureDir(ackDir);

  const content = readFileSync(filepath, 'utf-8');
  writeFileSync(join(ackDir, filename), content);
  unlinkSync(filepath);

  console.log(`Acknowledged: ${messageId}`);
}

function cmdAgents() {
  const registry = loadRegistry();
  const agents = Object.entries(registry.agents);

  if (agents.length === 0) {
    console.log('No agents registered. Use: brain-msg register --agent <id> --repo <path>');
    return;
  }

  console.log('Registered agents:\n');
  for (const [id, agent] of agents) {
    const inboxDir = join(INBOX_ROOT, id);
    let msgCount = 0;
    if (existsSync(inboxDir)) {
      msgCount = readdirSync(inboxDir).filter(f => f.endsWith('.json') && !f.startsWith('_')).length;
    }

    console.log(`  ${id}`);
    console.log(`    Repo: ${agent.repo}`);
    console.log(`    Capabilities: ${agent.capabilities.join(', ') || 'none'}`);
    console.log(`    Inbox: ${msgCount} message(s)`);
    console.log(`    Registered: ${agent.registered_at}`);
    console.log('');
  }
}

function cmdRegister(args: string[]) {
  let agentId = '', repo = '', capabilities: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--agent': agentId = args[++i]; break;
      case '--repo': repo = args[++i]; break;
      case '--capabilities': capabilities = args[++i].split(','); break;
    }
  }

  if (!agentId || !repo) {
    console.error('Usage: brain-msg register --agent <id> --repo <path> [--capabilities <cap1,cap2>]');
    process.exit(1);
  }

  const registry = loadRegistry();
  registry.agents[agentId] = {
    agent_id: agentId,
    repo,
    capabilities,
    registered_at: new Date().toISOString(),
  };
  saveRegistry(registry);

  // Create inbox directory
  ensureDir(join(INBOX_ROOT, agentId));

  console.log(`Registered agent: ${agentId}`);
  console.log(`  Repo: ${repo}`);
  console.log(`  Capabilities: ${capabilities.join(', ') || 'none'}`);
}

function cmdWorkOrder(args: string[]) {
  let to = '', subject = '', bodyStr = '{}', from = '';
  let priority = 'high';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--to': to = args[++i]; break;
      case '--subject': subject = args[++i]; break;
      case '--body': bodyStr = args[++i]; break;
      case '--from': from = args[++i]; break;
      case '--priority': priority = args[++i]; break;
    }
  }

  if (!from) {
    from = detectAgent() || 'unknown';
  }

  if (!to || !subject) {
    console.error('Usage: brain-msg work-order --to <agent> --subject <text> --body <json> [--priority high]');
    process.exit(1);
  }

  // 1. Look up target repo from registry
  const registry = loadRegistry();
  const targetAgent = registry.agents[to];
  if (!targetAgent) {
    console.error(`Error: Agent "${to}" not found in registry.`);
    console.error('Registered agents:');
    for (const id of Object.keys(registry.agents)) {
      console.error(`  ${id}`);
    }
    process.exit(1);
  }

  let body: any;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    body = { message: bodyStr };
  }
  body.priority = body.priority || priority;

  const targetRepo = targetAgent.repo;
  const claudeMdPath = join(targetRepo, 'CLAUDE.md');

  // 2. Send inbox message (standard delivery)
  const message: BrainMessage = {
    id: generateId(),
    version: '1.0',
    type: 'work_order',
    from,
    to,
    subject,
    body,
    timestamp: new Date().toISOString(),
    ttl_hours: 72,
  };

  const inboxDir = getAgentInbox(to);
  const filename = `${message.id}.json`;
  writeFileSync(join(inboxDir, filename), JSON.stringify(message, null, 2));
  console.log(`[1/3] Inbox message sent: ${join(inboxDir, filename)}`);

  // 3. Patch CLAUDE.md with work order banner (PUSH delivery)
  if (existsSync(claudeMdPath)) {
    const claudeMd = readFileSync(claudeMdPath, 'utf-8');
    const marker = '<!-- ACTIVE_WORK_ORDER -->';
    const endMarker = '<!-- /ACTIVE_WORK_ORDER -->';
    const actionLine = body.action ? `\n**Action**: ${body.action}` : '';
    const fileLine = body.file ? `\n**File**: \`${body.file}\`` : '';

    const banner = `${marker}
## ACTIVE WORK ORDER (from ${from}, ${new Date().toISOString().split('T')[0]})

**${subject}**

${body.message || JSON.stringify(body)}${actionLine}${fileLine}

Priority: **${priority}** | Ack with: \`bun .claude/skills/cross-brain-message/brain-msg.ts ack ${message.id}\`

---
${endMarker}`;

    let newContent: string;
    if (claudeMd.includes(marker)) {
      // Replace existing work order banner
      const startIdx = claudeMd.indexOf(marker);
      const endIdx = claudeMd.indexOf(endMarker);
      if (endIdx !== -1) {
        newContent = claudeMd.slice(0, startIdx) + banner + claudeMd.slice(endIdx + endMarker.length);
      } else {
        newContent = claudeMd.slice(0, startIdx) + banner + claudeMd.slice(startIdx + marker.length);
      }
    } else {
      // Insert after first heading line
      const firstNewline = claudeMd.indexOf('\n');
      if (firstNewline !== -1) {
        // Find end of first heading block (after # Title line)
        const secondNewline = claudeMd.indexOf('\n', firstNewline + 1);
        newContent = claudeMd.slice(0, secondNewline) + '\n\n' + banner + '\n' + claudeMd.slice(secondNewline);
      } else {
        newContent = claudeMd + '\n\n' + banner;
      }
    }

    writeFileSync(claudeMdPath, newContent);
    console.log(`[2/3] CLAUDE.md patched: ${claudeMdPath}`);
  } else {
    console.log(`[2/3] CLAUDE.md not found at ${claudeMdPath} — skipped`);
  }

  // 4. Update target's MEMORY.md if it exists
  const memoryPaths = [
    join(targetRepo, 'memory', 'MEMORY.md'),
    join(targetRepo, 'MEMORY.md'),
  ];

  let memoryPatched = false;
  for (const memPath of memoryPaths) {
    if (existsSync(memPath)) {
      const memContent = readFileSync(memPath, 'utf-8');

      // Check if there's already a "Pending Work Orders" section
      const woMarker = '## Pending Work Orders';
      const entry = `- **[${priority.toUpperCase()}]** ${subject} (from ${from}, ${new Date().toISOString().split('T')[0]}) — ${body.action || body.message || 'see inbox'}`;

      if (memContent.includes(woMarker)) {
        // Append to existing section (after the marker line)
        const markerIdx = memContent.indexOf(woMarker);
        const afterMarker = memContent.indexOf('\n', markerIdx);
        const newMem = memContent.slice(0, afterMarker + 1) + entry + '\n' + memContent.slice(afterMarker + 1);
        writeFileSync(memPath, newMem);
      } else {
        // Add section before the last --- or at the end
        const lastDivider = memContent.lastIndexOf('\n---\n');
        if (lastDivider !== -1) {
          const newMem = memContent.slice(0, lastDivider) + `\n\n${woMarker}\n\n${entry}\n` + memContent.slice(lastDivider);
          writeFileSync(memPath, newMem);
        } else {
          writeFileSync(memPath, memContent + `\n\n${woMarker}\n\n${entry}\n`);
        }
      }

      console.log(`[3/3] MEMORY.md updated: ${memPath}`);
      memoryPatched = true;
      break;
    }
  }

  if (!memoryPatched) {
    console.log(`[3/3] No MEMORY.md found — skipped`);
  }

  console.log(`\nWork order delivered to ${to} via 3 paths:`);
  console.log(`  1. Inbox message (poll-based)`);
  console.log(`  2. CLAUDE.md banner (always in context)`);
  console.log(`  3. MEMORY.md entry (startup checklist)`);
}

function cmdTypes() {
  console.log('Available message types:\n');
  for (const [type, info] of Object.entries(MESSAGE_TYPES)) {
    console.log(`  ${type}`);
    console.log(`    ${info.description}`);
    console.log(`    Body schema:`);
    for (const [key, val] of Object.entries(info.body_schema)) {
      console.log(`      ${key}: ${val}`);
    }
    console.log('');
  }
}

function getAge(timestamp: string): string {
  const ms = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function printHelp() {
  console.log(`
Cross-Brain Messaging CLI

Commands:
  send        Send a message to another brain (inbox only)
  work-order  Assign work — writes to CLAUDE.md + inbox + MEMORY.md (RECOMMENDED)
  inbox       Check your inbox
  ack         Acknowledge (archive) a message
  agents      List registered agents
  register    Register an agent
  types       Show available message types

Work-order options (writes to ALL discovery paths):
  --to <agent>           Target agent ID (required)
  --subject <text>       Work order title (required)
  --body <json>          Body with message, action, file, priority fields
  --priority <level>     low | medium | high | critical (default: high)
  --from <agent>         Sender ID (auto-detected from cwd)

Send options (inbox only):
  --to <agent>           Target agent ID (required)
  --type <type>          Message type (default: notification)
  --subject <text>       Message subject (required)
  --body <json>          Message body as JSON string
  --from <agent>         Sender ID (auto-detected from cwd)
  --correlation-id <id>  Link to a previous message

Inbox options:
  --agent <id>           Agent ID (auto-detected from cwd)
  -v, --verbose          Show full message bodies

Examples:
  # Send a work order (patches CLAUDE.md so brain CAN'T miss it)
  brain-msg work-order --to mech-browse-001 \\
    --subject "Fix 3 P0 production bugs" \\
    --body '{"message":"Read memory/SELF_IMPROVEMENT_PLAN.md","action":"read memory/SELF_IMPROVEMENT_PLAN.md","priority":"critical"}'

  # Send a simple notification (inbox only — brain must check)
  brain-msg send --to teleportation-gm --type bug_report \\
    --subject "Duplicate events" \\
    --body '{"symptoms":["6.8GB table"],"root_cause":"timestamp mismatch"}'

  brain-msg inbox --agent decisive-gm -v

  brain-msg ack msg-1234567890-abc123
`);
}

// === Main ===

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'send': cmdSend(args); break;
  case 'work-order': cmdWorkOrder(args); break;
  case 'inbox': cmdInbox(args); break;
  case 'ack': cmdAck(args); break;
  case 'agents': cmdAgents(); break;
  case 'register': cmdRegister(args); break;
  case 'types': cmdTypes(); break;
  case 'help': case '--help': case '-h': printHelp(); break;
  default:
    if (!command) {
      printHelp();
    } else {
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
    }
}
