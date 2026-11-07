'use client';

/**
 * Choose a department from a list, never type one (2026-11-04, user: "find
 * all the departments in a hospital so that people can dropdown and choose").
 *
 * The facility's own departments come first: the ones provisioned as records
 * on the Departments page and the names in its settings. The standard hospital
 * list follows (modules/departments/core/hospital-departments.ts), less any
 * the facility already lists under another spelling. The list is long enough
 * that Select adds its filter box, so typing "mat" still finds Maternity.
 *
 * The value is the department's name, as every department field already
 * stores. A stored value that is an alias ("OPD", "Pediatrics") shows as its
 * entry; one that is on no list is kept as its own choice rather than
 * silently dropped.
 */
import { useMemo } from 'react';
import Select from '@/components/Select';
import { useDepartments } from '@/lib/hooks/useDepartments';
import { useSettingsContext } from '@/lib/settings/SettingsProvider';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  HOSPITAL_DEPARTMENTS, HOSPITAL_DEPARTMENT_GROUPS, sameDepartment,
} from '@/modules/departments/client';

export interface DepartmentChoice {
  name: string;
  /** The facility's department record, when the choice is one. */
  departmentId?: string;
}

export function useDepartmentChoices(facilityId?: string, orgId?: string) {
  const { departments: records } = useDepartments(facilityId, orgId);
  // Settings are the signed-in user's own facility; for another facility
  // (an administrator registering staff elsewhere) only its records count.
  const settingsContext = useSettingsContext();
  // An account with no facility (platform, ministry) has only the defaults,
  // which are not anyone's facility list.
  const configured = settingsContext.loaded && settingsContext.hospitalId && (!facilityId || facilityId === settingsContext.hospitalId)
    ? settingsContext.settings.departments
    : undefined;
  return useMemo(() => {
    const facility: DepartmentChoice[] = [];
    const add = (choice: DepartmentChoice) => {
      if (!choice.name.trim()) return;
      if (!facility.some(item => sameDepartment(item.name, choice.name))) facility.push(choice);
    };
    records.filter(item => item.isActive).forEach(item => add({ name: item.name, departmentId: item._id }));
    (configured ?? []).forEach(name => add({ name }));
    facility.sort((a, b) => a.name.localeCompare(b.name));
    const standard = HOSPITAL_DEPARTMENTS.filter(item => !facility.some(own => sameDepartment(own.name, item.name)));
    return { facility, standard };
  }, [records, configured]);
}

export default function DepartmentSelect({
  value, onChange, facilityId, orgId, placeholder, className, style, disabled, id, required,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (name: string, choice?: DepartmentChoice) => void;
  facilityId?: string;
  orgId?: string;
  /** The empty choice's label. Defaults to "Choose a department". */
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  id?: string;
  required?: boolean;
  'aria-label'?: string;
}) {
  const { t } = useTranslation();
  const { facility, standard } = useDepartmentChoices(facilityId, orgId);

  const all = useMemo(() => [...facility, ...standard.map(item => ({ name: item.name }))], [facility, standard]);
  const matched = value ? all.find(item => sameDepartment(item.name, value)) : undefined;
  const shown = matched?.name ?? value;

  return (
    <Select
      id={id}
      className={className}
      style={style}
      disabled={disabled}
      required={required}
      aria-label={ariaLabel}
      value={shown}
      searchPlaceholder={t('departmentPicker.search')}
      onChange={event => {
        const name = event.target.value;
        onChange(name, all.find(item => item.name === name));
      }}
    >
      <option value="">{placeholder ?? t('departmentPicker.choose')}</option>
      {value && !matched && <option value={value}>{value}</option>}
      {facility.length > 0 && (
        <optgroup label={t('departmentPicker.groupFacility')}>
          {facility.map(item => <option key={`f-${item.name}`} value={item.name}>{item.name}</option>)}
        </optgroup>
      )}
      {HOSPITAL_DEPARTMENT_GROUPS.map(group => {
        const items = standard.filter(item => item.group === group);
        if (!items.length) return null;
        return (
          <optgroup key={group} label={t(`departmentPicker.group_${group}`)}>
            {items.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
          </optgroup>
        );
      })}
    </Select>
  );
}
