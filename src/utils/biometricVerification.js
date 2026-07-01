import { supabase } from '../supabaseClient';

const FUNCTION_NAME = 'biometric-verification';

const normalizeDescriptor = (descriptor) => Array.from(descriptor || [])
  .map((value) => Number(value))
  .filter((value) => Number.isFinite(value));

export const invokeBiometricVerification = async ({ action, email, descriptor, metadata }) => {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: {
      action,
      email,
      descriptor: normalizeDescriptor(descriptor),
      metadata: metadata || {},
    },
  });

  if (error) {
    throw error;
  }

  return data || { allowed: false, confidence: 0, reason: 'EMPTY_RESPONSE' };
};
