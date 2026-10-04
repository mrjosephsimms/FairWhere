-- Walking or riding (in a cart). The app uses it for the default usual pace and
-- for how the round time is split across holes (app/src/lib/pace.ts).
-- Owners can switch it mid-round (e.g. they pick up a cart at the turn).
alter table public.rounds
  add column mode text not null default 'riding' check (mode in ('walking', 'riding'));
