// Claude transport for the img2threejs studio. Two engines, one contract (system prompt +
// images + JSON schema in, parsed JSON out):
//   api — Claude API via @anthropic-ai/sdk when ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is set;
//   cli — the local Claude Code CLI (`claude -p`) and its login, used when there is no key.
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { z } from 'zod';
import type { EngineName, EngineStatus } from '@/shared/studio';

export const STUDIO_MODEL = 'claude-sonnet-5';
const STUDIO_EFFORT = 'medium';

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
export type LlmBlock = { type: 'text'; text: string } | { type: 'image'; mediaType: ImageMediaType; data: string };

export interface LlmCall {
  system: string;
  content: LlmBlock[];
  /** Shape Claude must return; the caller validates the parsed JSON itself. */
  schema: z.ZodType;
  signal: AbortSignal;
  onProgress(phase: 'thinking' | 'writing', chars: number): void;
}

export interface LlmResult {
  json: unknown;
  engine: EngineName;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

const cliCheck = globalThis as unknown as { __claudeCli?: { ok: boolean; at: number } };

function hasCli(): boolean {
  const cached = cliCheck.__claudeCli;
  if (cached && (cached.ok || Date.now() - cached.at < 60_000)) return cached.ok;
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 15_000 });
  cliCheck.__claudeCli = { ok: r.status === 0, at: Date.now() };
  return cliCheck.__claudeCli.ok;
}

export function engineStatus(): EngineStatus {
  const api = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const cli = hasCli();
  return { api, cli, active: api ? 'api' : cli ? 'cli' : null, model: STUDIO_MODEL };
}

export async function callClaude(call: LlmCall): Promise<LlmResult> {
  const { active } = engineStatus();
  if (active === 'api') return callApi(call);
  if (active === 'cli') return callCli(call);
  throw new Error('Chưa có engine Claude: đặt ANTHROPIC_API_KEY hoặc cài và đăng nhập Claude Code CLI (`claude`) trên máy chủ');
}

/** JSON schema of the reply; fields with defaults stay optional so Claude can omit them. */
function replySchema(schema: z.ZodType): Record<string, unknown> {
  // The CLI's validator knows draft-07 keywords but cannot resolve a "$schema" meta-schema URL.
  const { $schema: _meta, ...json } = z.toJSONSchema(schema, { io: 'input', target: 'draft-7' }) as Record<string, unknown>;
  return json;
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  try {
    return JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    throw new Error('Claude trả về JSON không hợp lệ');
  }
}

// ------------------------------------------------------------------ Claude API

async function callApi(call: LlmCall): Promise<LlmResult> {
  const client = new Anthropic({ timeout: 30 * 60 * 1000 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = call.content.map((b) =>
    b.type === 'text' ? { type: 'text', text: b.text } : { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } },
  );
  const format = jsonSchemaOutputFormat(replySchema(call.schema) as { type: 'object' });
  const run = async (structured: boolean) => {
    const stream = client.beta.messages.stream(
      {
        model: STUDIO_MODEL,
        max_tokens: 64000,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: STUDIO_EFFORT, ...(structured ? { format: { type: 'json_schema', schema: format.schema } } : {}) },
        system: [
          {
            type: 'text',
            text: structured ? call.system : `${call.system}\n\nReply with the JSON object only, no prose, matching this JSON schema:\n${JSON.stringify(format.schema)}`,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content }],
      },
      { signal: call.signal },
    );
    let thinking = 0;
    let writing = 0;
    stream.on('thinking', (delta) => call.onProgress('thinking', (thinking += delta.length)));
    stream.on('text', (delta) => call.onProgress('writing', (writing += delta.length)));
    return stream.finalMessage();
  };

  let message: Anthropic.Beta.BetaMessage;
  try {
    try {
      message = await run(true);
    } catch (e) {
      // A schema the structured-output grammar cannot compile is a 400; retry with the schema in the prompt.
      if (e instanceof Anthropic.BadRequestError && /schema|output_config|format/i.test(e.message)) message = await run(false);
      else throw e;
    }
  } catch (e) {
    throw apiError(e);
  }
  if (message.stop_reason === 'refusal') throw new Error('Claude từ chối yêu cầu này (refusal)');
  if (message.stop_reason === 'max_tokens') throw new Error('Claude hết giới hạn token trước khi viết xong spec');
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const u = message.usage;
  return {
    json: parseJsonText(text),
    engine: 'api',
    usage: { inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens, costUsd: 0 },
  };
}

function apiError(e: unknown): Error {
  if (e instanceof Anthropic.AuthenticationError) return new Error('ANTHROPIC_API_KEY không hợp lệ');
  if (e instanceof Anthropic.RateLimitError) return new Error('Claude API đang giới hạn tốc độ, thử lại sau');
  if (e instanceof Anthropic.APIUserAbortError) return new Error('Đã dừng');
  if (e instanceof Anthropic.APIError) return new Error(`Claude API lỗi ${e.status ?? ''}: ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}

// ------------------------------------------------------------------ Claude Code CLI

interface CliResult {
  type: 'result';
  is_error: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

function callCli(call: LlmCall): Promise<LlmResult> {
  const args = [
    '-p',
    // No CLAUDE.md, hooks, skills or MCP servers, and no tools: a plain model call.
    '--safe-mode',
    '--tools',
    '',
    '--no-session-persistence',
    '--model',
    STUDIO_MODEL,
    '--effort',
    STUDIO_EFFORT,
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--json-schema',
    JSON.stringify(replySchema(call.schema)),
    '--system-prompt',
    call.system,
  ];
  const content = call.content.map((b) => (b.type === 'text' ? { type: 'text', text: b.text } : { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } }));

  return new Promise((resolve, reject) => {
    if (call.signal.aborted) return reject(new Error('Đã dừng'));
    const child = spawn('claude', args, { cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    const onAbort = () => child.kill('SIGTERM');
    call.signal.addEventListener('abort', onAbort, { once: true });
    let buffer = '';
    let stderr = '';
    let result: CliResult | null = null;
    let thinking = 0;
    let writing = 0;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg: { type?: string; event?: { type?: string; delta?: { type?: string; thinking?: string; text?: string; partial_json?: string } } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === 'result') result = msg as CliResult;
        const delta = msg.type === 'stream_event' && msg.event?.type === 'content_block_delta' ? msg.event.delta : undefined;
        if (delta?.type === 'thinking_delta') call.onProgress('thinking', (thinking += delta.thinking?.length ?? 0));
        else if (delta?.type === 'text_delta' || delta?.type === 'input_json_delta') call.onProgress('writing', (writing += (delta.text ?? delta.partial_json ?? '').length));
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (e) => {
      call.signal.removeEventListener('abort', onAbort);
      reject(new Error(`Không chạy được Claude Code CLI: ${e.message}`));
    });
    child.on('close', (code) => {
      call.signal.removeEventListener('abort', onAbort);
      if (call.signal.aborted) return reject(new Error('Đã dừng'));
      const r = result as CliResult | null;
      if (!r || r.is_error) return reject(new Error(`Claude Code CLI lỗi (${r?.subtype ?? `exit ${code}`}): ${(r?.result ?? stderr).trim().slice(0, 500)}`));
      try {
        const json = r.structured_output ?? parseJsonText(r.result ?? '');
        const u = r.usage ?? {};
        resolve({
          json,
          engine: 'cli',
          usage: { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, costUsd: r.total_cost_usd ?? 0 },
        });
      } catch (e) {
        reject(e);
      }
    });
    // A CLI that exits before reading its input (bad flag, not logged in) must not crash the server with EPIPE; "close" reports it.
    child.stdin.on('error', () => undefined);
    child.stdin.end(`${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`);
  });
}
