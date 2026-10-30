// New-style secret key (sb_secret_...), falling back to the legacy service_role
// key that Supabase retires at the end of 2026.
export function secretKey(): string {
  try {
    const key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
    if (key) return key;
  } catch {
    // Not set on older projects.
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
