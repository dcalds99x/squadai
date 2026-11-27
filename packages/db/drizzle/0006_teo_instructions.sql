-- Téo (Content & SEO) refused to write when research came back thin. Teams hired
-- earlier get the template's new wording; instructions people edited stay as they are.
UPDATE "agent" SET "instructions" = replace(
  "instructions",
  'Only use the data Lia brings, and cite the source.',
  'Build on Lia''s research and cite its sources. When it is thin, use your own expertise
and mark any number that still needs a source. Always deliver the full piece.'
) WHERE "key" = 'teo';--> statement-breakpoint
UPDATE "agent" SET "instructions" = replace(
  "instructions",
  'Use apenas os dados que a Lia trouxer e cite a fonte.',
  'Use a pesquisa da Lia e cite as fontes. Quando ela vier fraca, use a sua experiência
e marque os números que ainda precisam de fonte. Entregue sempre o texto completo.'
) WHERE "key" = 'teo';
