-- Default visual formats (data, not code). Idempotent: existing rows are kept.
INSERT INTO "visual_format" ("id", "label", "width", "height", "channel", "layout", "active") VALUES
  ('article', 'Article (Open Graph)', 1200, 630, NULL, '{"padding":64,"titleSize":64,"subtitleSize":28,"logoHeight":56,"logoPosition":"top-left","titleMaxLines":3}', true),
  ('linkedin', 'LinkedIn (paysage)', 1200, 627, 'linkedin', '{"padding":64,"titleSize":60,"subtitleSize":28,"logoHeight":56,"logoPosition":"top-left","titleMaxLines":3}', true),
  ('instagram', 'Instagram (carré)', 1080, 1080, 'instagram', '{"padding":72,"titleSize":72,"subtitleSize":32,"logoHeight":64,"logoPosition":"top-left","titleMaxLines":4}', true),
  ('story', 'Story (portrait)', 1080, 1920, 'instagram', '{"padding":80,"titleSize":84,"subtitleSize":36,"logoHeight":72,"logoPosition":"top-left","titleMaxLines":5}', true)
ON CONFLICT ("id") DO NOTHING;
