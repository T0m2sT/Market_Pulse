-- Set when a week's briefing is a copy of an earlier week's (no new news): that earlier week_start.
ALTER TABLE news_briefings ADD COLUMN carried_from TEXT;
