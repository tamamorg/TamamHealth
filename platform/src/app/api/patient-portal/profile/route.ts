import { logApiError } from '@/lib/api-auth';
/**
 * Patient portal — own profile.
 *
 * GET /api/patient-portal/profile
 *
 * Exists so the login response does not have to carry PHI. Authentication is
 * an unauthenticated boundary by definition: the request that establishes a
 * session is the one most likely to be logged by middleware, proxied, retried,
 * or cached. Returning date of birth and phone number there put high-sensitivity
 * identifiers in exactly the wrong place — see the login route for the details.
 *
 * This endpoint is reached only with a valid patient JWT, and returns the
 * profile of THAT patient. The subject comes from the verified token (`auth.sub`),
 * never from a query parameter, so one patient cannot request another's record
 * by guessing an id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyPatientToken } from '@/lib/patient-portal-auth';

export async function GET(req: NextRequest) {
  const auth = await verifyPatientToken(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const { getPatientById } = await import('@/lib/services/patient-service');
    const patient = await getPatientById(auth.sub);

    if (!patient) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Explicit allow-list rather than a spread-and-delete. A spread leaks any
    // field added to PatientDoc later — which is how the login route ended up
    // returning the whole document, credential hashes aside.
    return NextResponse.json({
      profile: {
        id: patient._id,
        firstName: patient.firstName,
        middleName: patient.middleName,
        surname: patient.surname,
        hospitalNumber: patient.hospitalNumber,
        dateOfBirth: patient.dateOfBirth,
        gender: patient.gender,
        phone: patient.phone,
        address: patient.address,
        registrationHospital: patient.registrationHospital,
        registrationDate: patient.registeredAt ?? patient.createdAt,
      },
    });
  } catch (err) {
    logApiError('[patient-portal/profile]', err);
    return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
  }
}
