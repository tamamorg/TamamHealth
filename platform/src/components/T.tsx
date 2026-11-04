'use client';

import { interpolate } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/useTranslation';

/**
 * Translated text for server components, which cannot call useTranslation.
 * `en` (the key's English value) renders until the locale loads and on the
 * server, so the page never shows a raw key.
 */
export default function T({ k, en, vars }: { k: string; en: string; vars?: Record<string, string | number> }) {
  const { t } = useTranslation();
  const text = t(k, vars);
  return <>{text === k ? (vars ? interpolate(en, vars) : en) : text}</>;
}
