alter table public.submissions
  add column if not exists reference_number integer;

with ordered as (
  select id, row_number() over (order by submitted_at asc, id asc) as rn
  from public.submissions
)
update public.submissions s
set reference_number = ordered.rn
from ordered
where s.id = ordered.id;

create unique index if not exists submissions_reference_number_idx
  on public.submissions(reference_number)
  where reference_number is not null;
