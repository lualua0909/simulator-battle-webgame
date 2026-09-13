// Runs one studio pipeline step and streams its progress as NDJSON (one StudioEvent per line).
// The step keeps running if the browser disconnects; only the "stop" action aborts it.
import { z } from 'zod';
import { IMAGE_DATA_URL, type StudioEvent } from '@/shared/studio';
import { guard, issuesOf, jsonError, readJson } from '@/server/admin';
import { reviewStep, runStep, specStep, stopRun } from '@/server/studio/pipeline';
import { getJob, getJobDetail } from '@/server/studio/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('spec') }),
  z.object({
    action: z.literal('review'),
    version: z.number().int().min(1),
    sheet: z.string().max(8_000_000).regex(IMAGE_DATA_URL, 'sheet phải là ảnh PNG/JPEG'),
    feedback: z.string().trim().max(2000).nullable().default(null),
  }),
  z.object({ action: z.literal('stop') }),
]);

export async function POST(req: Request, ctx: Ctx) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!getJob(id)) return jsonError(404, 'Không tìm thấy job');
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(422, 'Dữ liệu không hợp lệ', issuesOf(parsed.error));
  const input = parsed.data;
  if (input.action === 'stop') return Response.json({ stopped: stopRun(id) });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (e: StudioEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      // Keeps proxies from timing out an idle connection while Claude thinks.
      const ping = setInterval(() => emit({ t: 'ping' }), 10_000);
      try {
        if (input.action === 'spec') await runStep(id, 'spec', (job, signal) => specStep(job, signal, emit));
        else await runStep(id, 'review', (job, signal) => reviewStep(job, { version: input.version, sheet: input.sheet, feedback: input.feedback || null }, signal, emit));
        emit({ t: 'done', job: getJobDetail(id)! });
      } catch (e) {
        emit({ t: 'error', error: e instanceof Error ? e.message : String(e) });
      } finally {
        clearInterval(ping);
        if (open) controller.close();
      }
    },
    cancel() {
      // Browser went away: the step continues and its versions are saved.
    },
  });
  // no-transform keeps response compression (and proxies) from buffering the event stream.
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' } });
}
