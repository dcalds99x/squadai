-- Protocol tokens and catalog ids moved from Portuguese to English.
-- Data-only: renames what earlier builds stored so existing offices keep working.
-- The parser still reads the old tags and plan keys, so paused runs need no rewrite.

-- The built-in "ask another team for help" tool.
UPDATE "agent_tool_policy" SET "tool" = 'request_help' WHERE "tool" = 'pedir_ajuda';
--> statement-breakpoint

-- Catalog template ids, in the template reference ("conteudo-seo@3" → "content-seo@3").
UPDATE "team" SET "template_ref" = regexp_replace("template_ref", '^conteudo-seo@', 'content-seo@') WHERE "template_ref" LIKE 'conteudo-seo@%';
--> statement-breakpoint
UPDATE "team" SET "template_ref" = regexp_replace("template_ref", '^pesquisa-mercado@', 'market-research@') WHERE "template_ref" LIKE 'pesquisa-mercado@%';
--> statement-breakpoint
UPDATE "team" SET "template_ref" = regexp_replace("template_ref", '^revisao-codigo@', 'code-review@') WHERE "template_ref" LIKE 'revisao-codigo@%';
--> statement-breakpoint

-- Team slugs that came from those ids ("conteudo-seo", "conteudo-seo-2", …), when the new slug is free.
UPDATE "team" AS t SET "slug" = regexp_replace(t."slug", '^conteudo-seo', 'content-seo')
WHERE t."slug" ~ '^conteudo-seo(-[0-9]+)?$'
  AND NOT EXISTS (SELECT 1 FROM "team" o WHERE o."workspace_id" = t."workspace_id" AND o."slug" = regexp_replace(t."slug", '^conteudo-seo', 'content-seo'));
--> statement-breakpoint
UPDATE "team" AS t SET "slug" = regexp_replace(t."slug", '^pesquisa-mercado', 'market-research')
WHERE t."slug" ~ '^pesquisa-mercado(-[0-9]+)?$'
  AND NOT EXISTS (SELECT 1 FROM "team" o WHERE o."workspace_id" = t."workspace_id" AND o."slug" = regexp_replace(t."slug", '^pesquisa-mercado', 'market-research'));
--> statement-breakpoint
UPDATE "team" AS t SET "slug" = regexp_replace(t."slug", '^revisao-codigo', 'code-review')
WHERE t."slug" ~ '^revisao-codigo(-[0-9]+)?$'
  AND NOT EXISTS (SELECT 1 FROM "team" o WHERE o."workspace_id" = t."workspace_id" AND o."slug" = regexp_replace(t."slug", '^revisao-codigo', 'code-review'));
--> statement-breakpoint

-- Cost rows for tool sub-calls were labelled "ferramenta:<tool>".
UPDATE "llm_call" SET "model" = 'tool:' || substr("model", length('ferramenta:') + 1) WHERE "model" LIKE 'ferramenta:%';
