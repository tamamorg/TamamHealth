'use client';

import { useId, type InputHTMLAttributes } from 'react';
import { useDepartments } from '@/lib/hooks/useDepartments';

/** Facility-backed suggestions while retaining legacy names and search terms. */
export default function DepartmentInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const { departments } = useDepartments();
  return <><input {...props} list={id} /><datalist id={id}>{[...new Set(departments.filter(item => item.isActive).map(item => item.name))].map(name => <option key={name} value={name} />)}</datalist></>;
}
