alter table public.submissions
  add column if not exists ai_generated boolean not null default false;

