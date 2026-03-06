-- Run this once in Supabase SQL Editor
alter table public.submissions
add column if not exists is_3d boolean not null default false;
