-- Mapped course features for the 3D hole game: fairway outlines, bunkers, water,
-- woods and trees (scripts/fetch_features.py, OpenStreetMap). Kept out of `data`
-- so the everyday course fetch stays small; the game loads it on demand.
alter table public.courses add column features jsonb;
