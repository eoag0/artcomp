-- Run this once in Supabase SQL Editor
alter table public.submissions
add column if not exists art_dimensions text;
