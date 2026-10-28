-- PAL 20.9: additive vendor review scheduling. Run once in existing Supabase SQL Editor before deploying 20.9.
-- Does not alter warehouse Storage, delete records, or change existing vendor details.
alter table public.pal_vendors add column if not exists baseline_review_date date;
alter table public.pal_vendors add column if not exists review_interval_days integer;
alter table public.pal_vendors drop constraint if exists pal_vendors_review_interval_days_check;
alter table public.pal_vendors add constraint pal_vendors_review_interval_days_check check (review_interval_days is null or review_interval_days in (30,45,60,90));
