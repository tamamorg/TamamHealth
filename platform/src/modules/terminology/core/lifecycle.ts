import type { VocabularyVersion, VocabularyVersionEvent, VocabularyVersionTransition } from './types';

function timestamp(value: string): number | null {
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function normalizedTimestamp(value: string): string {
  return new Date(value).toISOString();
}

/** Apply the only legal vocabulary transitions: draft → active → retired. */
export function transitionVocabularyVersion(
  current: VocabularyVersion,
  event: VocabularyVersionEvent,
): VocabularyVersionTransition {
  const at = timestamp(event.at);
  if (at === null) return { ok: false, reason: 'invalid_timestamp' };

  if (current.status === 'draft' && event.type === 'publish') {
    const createdAt = timestamp(current.createdAt);
    if (createdAt === null) return { ok: false, reason: 'invalid_timestamp' };
    if (at < createdAt) return { ok: false, reason: 'timestamp_before_previous_event' };
    return {
      ok: true,
      version: {
        ...current,
        createdAt: normalizedTimestamp(current.createdAt),
        status: 'active',
        publishedAt: normalizedTimestamp(event.at),
      },
    };
  }

  if (current.status === 'active' && event.type === 'retire') {
    const publishedAt = timestamp(current.publishedAt);
    if (publishedAt === null) return { ok: false, reason: 'invalid_timestamp' };
    if (at < publishedAt) return { ok: false, reason: 'timestamp_before_previous_event' };
    const createdAt = timestamp(current.createdAt);
    if (createdAt === null) return { ok: false, reason: 'invalid_timestamp' };
    return {
      ok: true,
      version: {
        ...current,
        createdAt: normalizedTimestamp(current.createdAt),
        publishedAt: normalizedTimestamp(current.publishedAt),
        status: 'retired',
        retiredAt: normalizedTimestamp(event.at),
      },
    };
  }

  return { ok: false, reason: 'invalid_transition' };
}
