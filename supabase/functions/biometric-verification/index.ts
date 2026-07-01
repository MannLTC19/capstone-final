// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type BiometricBody = {
  action?: 'verify' | 'enroll';
  email?: string;
  descriptor?: number[];
  metadata?: Record<string, unknown>;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const parseDescriptor = (input: unknown): number[] | null => {
  if (!Array.isArray(input)) return null;

  const values = input
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  return values.length === 128 ? values : null;
};

const euclideanDistance = (left: number[], right: number[]) => {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index] - right[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
};

const confidenceFromDistance = (distance: number) => {
  const normalized = Math.max(0, Math.min(1, 1 - Math.min(distance, 1)));
  return Number(normalized.toFixed(3));
};

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    'Content-Type': 'application/json',
  },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse({ allowed: false, confidence: 0, reason: 'SERVER_NOT_CONFIGURED' }, 500);
  }

  let body: BiometricBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ allowed: false, confidence: 0, reason: 'INVALID_JSON' }, 400);
  }

  const descriptor = parseDescriptor(body.descriptor);
  if (!descriptor) {
    return jsonResponse({ allowed: false, confidence: 0, reason: 'INVALID_DESCRIPTOR' }, 400);
  }

  const action = body.action ?? 'verify';

  if (action === 'enroll') {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!token) {
      return jsonResponse({ allowed: false, confidence: 0, reason: 'UNAUTHORIZED' }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: userData, error: userError } = await authClient.auth.getUser(token);
    if (userError || !userData.user) {
      return jsonResponse({ allowed: false, confidence: 0, reason: 'UNAUTHORIZED' }, 401);
    }

    const { error: deleteError } = await admin
      .from('faces')
      .delete()
      .eq('profile_id', userData.user.id);

    if (deleteError) {
      return jsonResponse({ allowed: false, confidence: 0, reason: 'ENROLL_DELETE_FAILED' }, 500);
    }

    const { error: insertError } = await admin
      .from('faces')
      .insert({
        profile_id: userData.user.id,
        descriptor,
        is_primary: true,
        metadata: {
          ...(body.metadata || {}),
          source: 'edge-function',
          enrolled_at: new Date().toISOString(),
        },
      });

    if (insertError) {
      return jsonResponse({ allowed: false, confidence: 0, reason: 'ENROLL_INSERT_FAILED' }, 500);
    }

    return jsonResponse({ allowed: true, confidence: 1 });
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!email) {
    return jsonResponse({ allowed: false, confidence: 0, reason: 'EMAIL_REQUIRED' }, 400);
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (profileError || !profile) {
    return jsonResponse({ allowed: false, confidence: 0, reason: 'NO_PROFILE' }, 200);
  }

  const { data: faces, error: facesError } = await admin
    .from('faces')
    .select('descriptor, is_primary')
    .eq('profile_id', profile.id)
    .order('is_primary', { ascending: false });

  if (facesError) {
    return jsonResponse({ allowed: false, confidence: 0, reason: 'FACE_LOOKUP_FAILED' }, 500);
  }

  const candidates = (faces || [])
    .map((entry) => parseDescriptor(entry.descriptor))
    .filter((entry): entry is number[] => Boolean(entry));

  if (candidates.length === 0) {
    return jsonResponse({ allowed: false, confidence: 0, reason: 'NO_REGISTERED_FACE' }, 200);
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.length !== descriptor.length) continue;
    const distance = euclideanDistance(descriptor, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
    }
  }

  if (!Number.isFinite(bestDistance)) {
    return jsonResponse({ allowed: false, confidence: 0, reason: 'NO_COMPARABLE_FACE' }, 200);
  }

  const threshold = 0.55;
  const allowed = bestDistance <= threshold;
  const confidence = confidenceFromDistance(bestDistance);

  return jsonResponse({
    allowed,
    confidence,
    reason: allowed ? 'MATCH' : 'FACE_MISMATCH',
  });
});
