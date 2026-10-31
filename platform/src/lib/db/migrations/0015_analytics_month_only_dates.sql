-- The analytics copy keeps births and deaths to the month. A full date beside a
-- place identifies a newborn or a death, and nothing here reads finer than a
-- month: the births view groups on DATE_TRUNC('month', ...). New rows are
-- rounded by sealIdentifyingColumns; this brings the rows already stored into
-- line. Safe to re-run.
UPDATE births SET date_of_birth = DATE_TRUNC('month', date_of_birth)::date
  WHERE date_of_birth <> DATE_TRUNC('month', date_of_birth)::date;
UPDATE deaths SET date_of_birth = NULL WHERE date_of_birth IS NOT NULL;
UPDATE deaths SET date_of_death = DATE_TRUNC('month', date_of_death)::date
  WHERE date_of_death <> DATE_TRUNC('month', date_of_death)::date;
