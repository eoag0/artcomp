-- Run this once in Supabase SQL Editor
create table if not exists public.votes (
  id bigint generated always as identity primary key,
  voter_email text not null,
  submission_id bigint not null references public.submissions(id) on delete cascade,
  voted_at timestamptz not null default now()
);

create unique index if not exists votes_voter_email_unique
on public.votes (lower(voter_email));

alter table public.votes enable row level security;
