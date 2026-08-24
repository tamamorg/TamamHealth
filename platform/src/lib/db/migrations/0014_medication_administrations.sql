CREATE TABLE IF NOT EXISTS medication_administrations (
  id TEXT PRIMARY KEY,
  prescription_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  patient_name TEXT,
  admission_id TEXT,
  hospital_id TEXT,
  org_id TEXT,
  event_kind TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  dose_given TEXT,
  route TEXT,
  administered_by TEXT NOT NULL,
  administered_by_name TEXT,
  witness_id TEXT,
  witness_name TEXT,
  reason TEXT,
  notes TEXT,
  voids_administration_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_med_admin_patient_time
  ON medication_administrations (patient_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_med_admin_admission_time
  ON medication_administrations (admission_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS idx_med_admin_prescription
  ON medication_administrations (prescription_id);
