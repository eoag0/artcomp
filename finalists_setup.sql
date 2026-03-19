-- Run this once in Supabase SQL Editor
create table if not exists public.finalists (
  submission_id bigint primary key references public.submissions(id) on delete cascade,
  tier text not null default 'Finalist',
  tagged_at timestamptz not null default now()
);

alter table public.finalists enable row level security;
