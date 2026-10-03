-- Friends see the score: anyone who can see a round (rounds RLS: accepted friends
-- or selected viewers, while live or for 4h after finishing) can read its scorecard.
-- The subquery runs under the reader's own rounds policy, so the windows match.
-- Writing stays owner-only.
drop policy round_scores_select on public.round_scores;
create policy round_scores_select on public.round_scores for select to authenticated
  using (exists (select 1 from public.rounds r where r.id = round_id));

-- Friends' screens update live as strokes are entered.
alter publication supabase_realtime add table public.round_scores;
