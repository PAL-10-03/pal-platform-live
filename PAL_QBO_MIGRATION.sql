-- Run in the existing PAL private Supabase project's SQL editor.
-- Service-role access ONLY. Never expose these tables to authenticated browser clients.
create table if not exists public.pal_qbo_connections (
 tenant text primary key check (tenant = 'born-again-air'),
 realm_id text not null unique,
 encrypted_tokens text not null,
 updated_at timestamptz not null default now()
);
create table if not exists public.pal_qbo_oauth_states (
 state_hash text primary key,
 tenant text not null check (tenant = 'born-again-air'),
 clerk_user_id text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
alter table public.pal_qbo_connections enable row level security;
alter table public.pal_qbo_oauth_states enable row level security;
revoke all on public.pal_qbo_connections from anon, authenticated;
revoke all on public.pal_qbo_oauth_states from anon, authenticated;
-- Supabase service_role bypasses RLS. No end-user RLS policies are created.
