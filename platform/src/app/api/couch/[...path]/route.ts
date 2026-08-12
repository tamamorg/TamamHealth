import { NextRequest, NextResponse } from 'next/server';
import { getAuthPayload, unauthorized, forbidden, logApiError } from '@/lib/api-auth';
import { ensureCouchGatewayUser } from '@/lib/sync/couch-auth';
import {
  gatewayRequestAllowed,
  resolveGatewayDatabase,
  validateGatewayWriteBody,
} from '@/lib/sync/sync-gateway';

export const dynamic = 'force-dynamic';
const MAX_PROXY_BODY_BYTES = 25 * 1024 * 1024;

async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    if (process.env.NEXT_PUBLIC_COUCHDB_GATEWAY_ENABLED !== 'true') {
      return NextResponse.json({ error: 'Sync gateway is disabled' }, { status: 404 });
    }
    const auth = await getAuthPayload(request);
    if (!auth) return unauthorized();

    const { path } = await context.params;
    if (!Array.isArray(path) || path.length < 1) {
      return NextResponse.json({ error: 'Database path is required' }, { status: 400 });
    }
    const database = path[0];
    const config = resolveGatewayDatabase(database, auth.orgId);
    if (!config) return forbidden('This database is outside your organization.');
    if (!gatewayRequestAllowed(config, request.method, path.slice(1))) {
      return forbidden('This replication operation is not allowed for the database.');
    }

    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_PROXY_BODY_BYTES) {
      return NextResponse.json({ error: 'Sync request is too large' }, { status: 413 });
    }

    const base = (process.env.COUCHDB_URL || '').replace(/\/+$/, '');
    if (!base) throw new Error('COUCHDB_URL is not configured');
    const credentials = await ensureCouchGatewayUser(auth);
    const upstream = new URL(`${base}/${path.map(encodeURIComponent).join('/')}`);
    request.nextUrl.searchParams.forEach((value, key) => upstream.searchParams.append(key, value));

    const headers = new Headers();
    for (const name of ['accept', 'content-type', 'if-match', 'if-none-match', 'range']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set(
      'authorization',
      `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
    );

    const hasBody = !['GET', 'HEAD'].includes(request.method.toUpperCase());
    const body = hasBody ? await request.arrayBuffer() : undefined;
    if (body && body.byteLength > MAX_PROXY_BODY_BYTES) {
      return NextResponse.json({ error: 'Sync request is too large' }, { status: 413 });
    }
    if (hasBody) {
      let parsed: unknown;
      if (body && body.byteLength > 0 && isJsonRequest(request)) {
        try {
          parsed = JSON.parse(new TextDecoder().decode(body));
        } catch {
          return NextResponse.json({ error: 'Sync request contains invalid JSON' }, { status: 400 });
        }
      }
      const validationError = validateGatewayWriteBody(config, request.method, path.slice(1), parsed);
      if (validationError) {
        const status = body && body.byteLength > 0 && !isJsonRequest(request) ? 415 : 400;
        return NextResponse.json({ error: validationError }, { status });
      }
    }
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });

    const responseHeaders = new Headers();
    for (const name of ['cache-control', 'content-encoding', 'content-length', 'content-range', 'content-type', 'etag']) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set('cache-control', 'no-store');
    return new NextResponse(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    logApiError('[API /couch gateway]', error);
    return NextResponse.json({ error: 'Sync gateway unavailable' }, { status: 502 });
  }
}

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;

function isJsonRequest(request: NextRequest): boolean {
  const contentType = request.headers.get('content-type') || '';
  return contentType.includes('application/json');
}
