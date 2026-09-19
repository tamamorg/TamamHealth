'use client';

import type { CSSProperties } from 'react';
import { Icon } from '@/components/icons';
import type { NavIcon } from '@/lib/permissions';
import { moduleIdentity } from './module-identity';
import styles from './ModuleIcon.module.css';

/** Decorative: the adjacent module name/button label supplies the accessible name. */
export default function ModuleIcon({ href, icon: Glyph, compact = false }: { href: string; icon?: NavIcon; compact?: boolean }) {
  const identity = moduleIdentity(href);
  return <span aria-hidden="true" data-module-tone={identity.tone}
    className={`${styles.tile} ${compact ? styles.compact : ''}`}
    style={{ '--module-tone': `var(--module-${identity.tone})` } as CSSProperties}>
    {Glyph ? <Glyph size={20} /> : <Icon name={identity.icon} size={20} />}
  </span>;
}
