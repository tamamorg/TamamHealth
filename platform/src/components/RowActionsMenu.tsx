'use client';

import type { ReactNode } from 'react';
import { Pencil } from '@/components/icons/lucide';
import Menu, { type MenuItem } from '@/components/overlay/Menu';

export type RowAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** One line under the label on what pressing it does. */
  hint?: string;
  tone?: 'default' | 'success' | 'danger';
  disabled?: boolean;
  /** Actions sharing a group sit together; a hairline separates groups. */
  group?: string;
  onClick: () => void;
};

/**
 * Shared row-action menu (pencil trigger) used across every data table in
 * the platform. The trigger keeps each row's action area to a single compact
 * button regardless of how many actions a row offers; the panel is the
 * shared `Menu` surface, so it is portalled clear of the table's scroll
 * container, keyboard-navigable, and styled like every other menu.
 */
export default function RowActionsMenu({ actions, ariaLabel = 'Actions' }: { actions: RowAction[]; ariaLabel?: string }) {
  if (!actions.length) return null;
  const items: MenuItem[] = actions.map(action => ({
    key: action.key,
    label: action.label,
    hint: action.hint,
    icon: action.icon,
    tone: action.tone,
    disabled: action.disabled,
    group: action.group,
    onSelect: action.onClick,
  }));
  return (
    <Menu
      items={items}
      label={ariaLabel}
      icon={<Pencil aria-hidden="true" />}
      align="end"
      width={220}
    />
  );
}
