'use client';

import type { ComponentType, CSSProperties, SVGProps } from 'react';
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

interface EmptyStateProps {
  icon?: IconComponent;
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const Inbox = DuotoneFileText;

export default function EmptyState({ icon: Icon = Inbox, title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{
        background: 'transparent',
      }}>
        <Icon className="w-6 h-6" style={{ color: 'var(--text-muted, #64748b)' }} />
      </div>
      <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary, #0F172A)' }}>{title}</h3>
      <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted, #64748b)' }}>{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all"
          style={{
            background: 'linear-gradient(135deg, #2191D0, #015697)',
            boxShadow: '0 2px 8px rgba(33, 145, 208, 0.3)',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
