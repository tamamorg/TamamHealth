'use client';

/**
 * The next step, not just the absence.
 *
 * An empty list that only says "nothing here" leaves the user to work out
 * whether that is a problem and what to do about it. This names what would
 * be here, says why it is empty when that is known, and offers the action
 * that fills it. Sizes: `md` for a panel or page, `sm` for a card, `inline`
 * for a row inside a table body (where the header row stays above it).
 *
 * Every colour and spacing is a token (`.tm-empty`); the hard-coded gradient
 * and shadow the old version painted are gone.
 */

import type { ComponentType, CSSProperties, ReactNode, SVGProps } from 'react';
import { DuotoneFileText } from '@/components/icons';

type IconComponent = ComponentType<
  Omit<SVGProps<SVGSVGElement>, 'color'> & {
    size?: number | string;
    strokeWidth?: number | string;
    color?: string;
    style?: CSSProperties;
    className?: string;
    absoluteStrokeWidth?: boolean;
  }
>;

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon?: IconComponent;
  title: string;
  message?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  size?: 'sm' | 'md';
  /** Row layout for inside a table body or a dense card. */
  inline?: boolean;
  /** Extra content under the copy — a filter reset, a hint list. */
  children?: ReactNode;
  className?: string;
}

const Inbox = DuotoneFileText;

export default function EmptyState({
  icon: Icon = Inbox,
  title,
  message,
  action,
  secondaryAction,
  size = 'md',
  inline = false,
  children,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`tm-empty${size === 'sm' ? ' tm-empty--sm' : ''}${inline ? ' tm-empty--inline' : ''}${className ? ` ${className}` : ''}`}>
      <div className="tm-empty__icon" aria-hidden="true">
        <Icon />
      </div>
      <div className="tm-empty__copy">
        <h3 className="tm-empty__title">{title}</h3>
        {message && <p className="tm-empty__text">{message}</p>}
        {children}
      </div>
      {(action || secondaryAction) && (
        <div className="tm-empty__actions">
          {secondaryAction && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          )}
          {action && (
            <button type="button" className="btn btn-primary btn-sm" onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
