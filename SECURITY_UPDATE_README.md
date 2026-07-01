# Security Update Summary

This project was updated to move biometric verification out of the browser and into a Supabase-backed server boundary.

## What changed

The previous flow compared face descriptors directly in the client and treated browser state as authoritative. That created a trust issue because a user could inspect or tamper with the descriptor data in the browser.

The new flow does this instead:

- The browser still captures a face descriptor from the webcam.
- The browser sends only the descriptor payload to a Supabase Edge Function.
- The Edge Function compares the descriptor on the server.
- The function returns only a small decision object:
  - `allowed` true or false
  - `confidence` score
  - optional `reason`

## Files added

- `src/utils/biometricVerification.js` - shared client helper that calls the Edge Function
- `supabase/functions/biometric-verification/index.ts` - server-side biometric verification and enrollment logic

## Client updates

The following views were updated to stop performing face matching in the browser:

- `src/views/LoginView.jsx`
- `src/views/LoginPage.jsx`
- `src/views/RegisterView.jsx`
- `src/views/AttendanceView.jsx`

The app no longer relies on client-side face descriptor comparison for authentication decisions.

## Security improvements

- Biometric matching now happens server-side.
- The browser no longer receives the full set of face descriptors.
- The custom biometric login event bridge was removed.
- Legacy biometric session state was removed from the auth flow.
- The last live `face_descriptor` reads were removed from the frontend security path.

## Notes on deployment

This change is only complete after the Edge Function is deployed in Supabase.

Before using it in production, make sure:

- `SUPABASE_URL` is set for the function environment
- `SUPABASE_SERVICE_ROLE_KEY` is set for the function environment
- RLS policies are added for biometric and attendance tables
- the `faces` table is treated as the canonical biometric store

## Behavioral contract

The new biometric function is expected to return only:

```json
{
  "allowed": true,
  "confidence": 0.93,
  "reason": "MATCH"
}
```

or the equivalent negative result.

It should not return raw descriptors, full profile lists, or other biometric data.

## Why this is safer

This design reduces exposure in three ways:

- the client no longer decides who is authenticated
- the client no longer needs access to other users' descriptors
- the verification result is narrow and harder to abuse

## Recommended next steps

1. Add Supabase RLS policies for `faces`, `attendance`, `profiles`, and other writable tables.
2. Verify the Edge Function is deployed and accessible from the app.
3. Test one successful match and one failed match to confirm the response contract.
4. Add logging or audit records for verification attempts if you want stronger traceability.
