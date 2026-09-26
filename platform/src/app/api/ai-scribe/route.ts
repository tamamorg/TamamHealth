import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthPayload, verifyCsrfToken, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/modules/identity';
import { getUserById } from '@/modules/identity/services/user-service';
import { getClinicalNoteById } from '@/lib/clinical-notes/note-service';
import { auditLogDB } from '@/lib/db';
import { canUseScribe, isScribeSection, MAX_SOURCE, MAX_AUDIO } from '@/modules/ai-scribe';
import { getScribeConfig, readBounded, generate, transcribe, ScribeError } from '@/modules/ai-scribe/services/gateway.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const windows = new Map<string, { count: number; expires: number }>();
let active = 0;
function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff' } });
}
function takeSlot(user: string) {
  const now = Date.now();
  for (const [key, value] of windows) if (value.expires <= now) windows.delete(key);
  const w = windows.get(user) || { count: 0, expires: now + 60000 };
  if (active >= 2 || w.count >= 8 || windows.size >= 1000) throw new ScribeError('busy', 429);
  w.count++; windows.set(user, w); active++;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthPayload(request); if (!auth) return reply({ error: 'unauthorized' }, 401);
  try {
    const c = getScribeConfig();
    return reply({ available: c.facilities.includes(`${auth.orgId}/${auth.hospitalId}`) });
  } catch { return reply({ available: false }); }
}

export async function POST(request: NextRequest) {
  let held = false;
  try {
    const auth = await getAuthPayload(request); if (!auth || auth.mustChangePassword) return reply({ error: 'unauthorized' }, 401);
    const token = request.headers.get(CSRF_HEADER_NAME) || '';
    if (request.headers.get('origin') !== request.nextUrl.origin || request.cookies.get(CSRF_COOKIE_NAME)?.value !== token || !await verifyCsrfToken(token, auth.sub)) return reply({ error: 'forbidden' }, 403);
    const cfg = getScribeConfig();
    const user = await getUserById(auth.sub);
    if (!user || user.isActive === false || !user.orgId || !user.hospitalId || user.orgId !== auth.orgId || user.hospitalId !== auth.hospitalId
      || user.role !== auth.role || !cfg.facilities.includes(`${user.orgId}/${user.hospitalId}`)) return reply({ error: 'forbidden' }, 403);
    takeSlot(auth.sub); held = true;
    const bytes = await readBounded(request.body, MAX_AUDIO + 32000, AbortSignal.any([request.signal, AbortSignal.timeout(15000)]));
    const form = await new Response(bytes as BodyInit, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
    const noteId = form.get('noteId'); const revision = form.get('revision'); const section = form.get('section'); const action = form.get('action');
    if (typeof noteId !== 'string' || noteId.length > 150 || typeof revision !== 'string' || revision.length > 100 || !isScribeSection(section)
      || !['generate', 'transcribe'].includes(String(action)) || form.get('consent') !== 'confirmed') return reply({ error: 'invalid_input' }, 400);
    const scope = { orgId: user.orgId, hospitalId: user.hospitalId, role: user.role, userId: user._id };
    const note = await getClinicalNoteById(noteId, scope);
    if (!note || !canUseScribe(user, note) || note.hospitalId !== user.hospitalId || !note.patientId) return reply({ error: 'forbidden' }, 403);
    if (note._rev !== revision || !note.sections.some(s => s.sectionId === section)) return reply({ error: 'stale_note' }, 409);
    const requestId = randomUUID(); const now = new Date().toISOString();
    const audit = async (phase: string) => {
      await auditLogDB().put({ _id: `audit-${randomUUID()}`, type: 'audit_log', action: `SCRIBE_${phase}`, userId: user._id,
        orgId: user.orgId, hospitalId: user.hospitalId, details: JSON.stringify({ requestId, noteId, section, action, consentAttested: true, approval: cfg.approval }),
        success: phase !== 'FAILED', createdAt: now, updatedAt: now });
    };
    let audio: Blob | undefined; let source: string | undefined;
    if (action === 'transcribe') {
      const file = form.get('audio');
      if (!(file instanceof Blob) || file.size < 16 || file.size > MAX_AUDIO || !['audio/webm','audio/mp4'].includes(file.type)) return reply({ error: 'invalid_audio' }, 400);
      const prefix = new Uint8Array(await file.slice(0,12).arrayBuffer());
      if (file.type === 'audio/webm' ? !(prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3) : new TextDecoder().decode(prefix.slice(4,8)) !== 'ftyp') return reply({ error: 'invalid_audio' }, 400);
      audio = file;
    } else {
      const text = form.get('source');
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_SOURCE) return reply({ error: 'invalid_input' }, 400);
      source = text;
    }
    await audit('REQUESTED'); // Fail closed before hospital inference if audit storage is unavailable.
    try {
      const result = audio ? { transcript: await transcribe(audio, request.signal) } : await generate(source!, section, request.signal);
      // A note signed or edited while inference ran must not receive the old result.
      const latest = await getClinicalNoteById(noteId, scope);
      const liveAuth = await getAuthPayload(request);
      const liveUser = await getUserById(user._id);
      if (!liveAuth || liveAuth.mustChangePassword || !liveUser || liveUser.isActive === false || liveUser.role !== user.role || liveUser.orgId !== user.orgId || liveUser.hospitalId !== user.hospitalId) throw new ScribeError('forbidden', 403);
      if (!latest || latest.hospitalId !== user.hospitalId || !canUseScribe(liveUser, latest) || latest._rev !== revision) throw new ScribeError('stale_note', 409);
      await audit('GENERATED');
      return reply({ ...result, requestId });
    } catch (error) { await audit('FAILED'); throw error; }
  } catch (error) {
    return reply({ error: error instanceof ScribeError ? error.code : 'unavailable' }, error instanceof ScribeError ? error.status : 503);
  } finally { if (held) active--; }
}
