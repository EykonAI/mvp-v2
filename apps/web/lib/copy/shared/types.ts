// ─── THE CHANNEL-WRITER CONTRACT ─────────────────────────────────
//
// A channel is a data structure, not a code path. The compose loop in
// shared/compose.ts is the only place the agent-first / template-always
// / never-throws behaviour lives; a channel that needs a branch inside
// that loop means this interface is wrong — widen the interface.
//
// The union is declared ONCE, here. store.ts and the migration CHECK
// must agree with it; migration 116 is where the database learned the
// three new values.

import type { Evidence } from '@/lib/newsjack/template';

export type NewsjackChannel = 'x' | 'linkedin' | 'substack' | 'reddit' | 'discord' | 'tiktok';

export type Register = 'flat' | 'dry' | 'open';

export interface ChannelArtifact {
  /** What the founder copies — one string, assembled for display. */
  body: string;
  /** The structured parts, as the writer returned them. X: the posts.
   *  Reddit: [title, body]. Discord: [message, embed JSON]. TikTok: the
   *  script package lines. Lands in newsjack_drafts.posts (JSONB string[]). */
  posts: string[];
  /** The tagged replay URL. Computed by the TEMPLATE and reused by the
   *  agent path, so the two can never attribute differently. */
  refUrl: string;
}

export interface CraftResult {
  ok: boolean;
  violations: string[];
  warnings: string[];
}

export interface ComposeMeta {
  composer: 'agent' | 'template';
  model: string | null;
  codexVersion: string | null;
  register: string;
  attempts: number;
  fallbackReason: string | null;
  craftWarnings: string[];
  /** What the FIRST attempt failed on, even when the retry then succeeded.
   *  The instrument that made the harm-gate bug readable (#421/#423). */
  firstAttemptViolations: string[];
}

export interface ComposeResult {
  artifact: ChannelArtifact;
  meta: ComposeMeta;
}

export interface ComposeOptions {
  /** Compose even when the channel's copywriter flag is off. ONLY for the
   *  founder-gated dry-run recompose; the engine never passes it. */
  force?: boolean;
  /** Compose at a specific register regardless of the env default. The
   *  harm rule still wins over any override. */
  register?: Register;
}

// The Anthropic tool parameter shape, kept loose on purpose: the SDK's
// own type is what the call site enforces.
export interface WriterTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChannelWriter {
  channel: NewsjackChannel;
  /** PAMS tag + medium. Must exist in lib/attribution/channels.ts CHANNELS
   *  or withChannel() silently returns an untagged URL — the tiktok lesson. */
  utmSource: string;
  utmMedium: 'social' | 'community' | 'email' | 'referral';
  /** Null for template-only writers — matches the DB rows they have always
   *  written (codex_version null), so the refactor is invisible in the data. */
  codexVersion: string | null;
  /** The per-channel kill switch. Off = the TEMPLATE writes; the channel
   *  itself is removed only by deleting the registry entry (a deploy). */
  enabled(): boolean;
  model(): string;
  defaultRegister: Register;
  registerEnvVar: string;
  /** The deterministic fallback. MUST exist and MUST keep working — the
   *  never-throws guarantee is only as real as this function. */
  template(ev: Evidence): ChannelArtifact;
  tool: WriterTool;
  systemPrompt(ev: Evidence, register: Register): string;
  userPrompt(ev: Evidence, refUrl: string): string;
  /** Tool input → artifact, or null when the shape is unusable — treated
   *  by the loop as a normal failure (template), never an exception. */
  assemble(input: unknown, refUrl: string): ChannelArtifact | null;
  craftLint(a: ChannelArtifact, ev: Evidence, refUrl: string, recent: string[]): CraftResult;
  maxTokensOut: number;
}
