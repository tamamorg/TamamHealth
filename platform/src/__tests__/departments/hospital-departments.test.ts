import { HOSPITAL_DEPARTMENTS, departmentKey, hospitalDepartmentFor, sameDepartment } from '@/modules/departments/client';

describe('hospital department list', () => {
  it('has no two entries that mean the same department', () => {
    const seen = new Map<string, string>();
    for (const item of HOSPITAL_DEPARTMENTS) {
      for (const spelling of [item.name, ...(item.aliases ?? [])]) {
        const key = departmentKey(spelling);
        expect(seen.get(key) ?? item.name).toBe(item.name);
        seen.set(key, item.name);
      }
    }
  });

  it('lands old spellings on their entry', () => {
    expect(hospitalDepartmentFor('OPD')?.name).toBe('Outpatient');
    expect(hospitalDepartmentFor('Pediatrics')?.name).toBe('Paediatrics');
    expect(hospitalDepartmentFor('records')?.name).toBe('Records & HMIS');
    expect(sameDepartment('Obstetrics and Gynaecology', 'OB/GYN')).toBe(true);
    expect(sameDepartment('Maternity', 'Pharmacy')).toBe(false);
  });

  it('covers every department the seed gives staff', () => {
    for (const name of ['Administration', 'Public Health', 'County Health Office', 'Internal Medicine', 'Outpatient', 'General Medicine',
      'Nursing', 'Emergency', 'Maternity', 'Pharmacy', 'Laboratory', 'Radiology', 'Nutrition', 'Reception', 'Billing',
      'Records', 'Registration', 'Records & HMIS', 'Human Resources']) {
      expect(hospitalDepartmentFor(name)).toBeDefined();
    }
  });
});
