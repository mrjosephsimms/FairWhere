-- Profile: a home course you choose (Edit profile). Used for your profile header and
-- as the default on Start a Round when you're not standing at another course.
alter table public.profiles add column home_course_id text references public.courses (id) on delete set null;
grant update (home_course_id) on public.profiles to authenticated;
