-- Run this once in Supabase SQL Editor
alter table public.submissions
add column if not exists artist_age integer,
add column if not exists artist_school text;
