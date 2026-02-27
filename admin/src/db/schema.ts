import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';

// ─── Enums ───

export const feedTypeEnum = pgEnum('feed_type', [
  'investigation',
  'mainstream',
  'fact-check',
  'institutionnel',
  'etranger',
]);

export const langueEnum = pgEnum('langue', ['fr', 'en', 'de', 'es']);

export const runStatusEnum = pgEnum('run_status', ['success', 'failed', 'running']);

export const stepStatusEnum = pgEnum('step_status', ['success', 'failed', 'skipped', 'running']);

// ─── Tables ───

/** RSS feed sources (replaces hardcoded FEEDS array in fetch-news.ts) */
export const feeds = pgTable('feeds', {
  id: serial('id').primaryKey(),
  nom: varchar('nom', { length: 100 }).notNull(),
  url: text('url').notNull().unique(),
  type: feedTypeEnum('type').notNull(),
  pays: varchar('pays', { length: 50 }).notNull(),
  langue: langueEnum('langue').notNull().default('fr'),
  fiabilite: integer('fiabilite').notNull().default(3),
  active: boolean('active').notNull().default(true),
  lastFetchStatus: varchar('last_fetch_status', { length: 20 }),
  lastFetchAt: timestamp('last_fetch_at'),
  lastFetchArticleCount: integer('last_fetch_article_count'),
  lastFetchError: text('last_fetch_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Pipeline execution logs */
export const pipelineRuns = pgTable('pipeline_runs', {
  id: varchar('id', { length: 100 }).primaryKey(),
  date: varchar('date', { length: 10 }).notNull(),
  startedAt: timestamp('started_at').notNull(),
  finishedAt: timestamp('finished_at'),
  durationS: integer('duration_s'),
  status: runStatusEnum('status').notNull().default('running'),
  deployed: boolean('deployed').notNull().default(false),
  triggeredBy: varchar('triggered_by', { length: 50 }).default('manual'),
  githubRunId: varchar('github_run_id', { length: 50 }),
  articlesFetched: integer('articles_fetched'),
  feedsOk: integer('feeds_ok'),
  feedsTotal: integer('feeds_total'),
  faitsDuJour: integer('faits_du_jour'),
  regardsCroises: integer('regards_croises'),
  regardEtranger: integer('regard_etranger'),
  provider: varchar('provider', { length: 50 }),
  model: varchar('model', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** Individual step results per pipeline run */
export const runSteps = pgTable('run_steps', {
  id: serial('id').primaryKey(),
  runId: varchar('run_id', { length: 100 })
    .notNull()
    .references(() => pipelineRuns.id),
  name: varchar('name', { length: 200 }).notNull(),
  status: stepStatusEnum('status').notNull(),
  durationS: integer('duration_s'),
  error: text('error'),
  order: integer('order').notNull(),
});

/** Cached fetched articles (for browsing in admin) */
export const articles = pgTable('articles', {
  id: varchar('id', { length: 12 }).primaryKey(),
  titre: text('titre').notNull(),
  description: text('description'),
  url: text('url').notNull(),
  source: varchar('source', { length: 100 }).notNull(),
  type: feedTypeEnum('type').notNull(),
  pays: varchar('pays', { length: 50 }),
  langue: langueEnum('langue'),
  date: timestamp('date').notNull(),
  fiabilite: integer('fiabilite'),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
  runId: varchar('run_id', { length: 100 }).references(() => pipelineRuns.id),
});

/** Archived editions (une.json snapshots) */
export const editions = pgTable('editions', {
  id: serial('id').primaryKey(),
  date: varchar('date', { length: 10 }).notNull().unique(),
  content: jsonb('content').notNull(),
  titreUne: text('titre_une'),
  categorie: varchar('categorie', { length: 50 }),
  faitsDuJourCount: integer('faits_du_jour_count'),
  regardsCroisesCount: integer('regards_croises_count'),
  regardEtrangerCount: integer('regard_etranger_count'),
  provider: varchar('provider', { length: 50 }),
  model: varchar('model', { length: 100 }),
  manuallyEdited: boolean('manually_edited').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/** Key-value settings store */
export const settings = pgTable('settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: text('value').notNull(),
  encrypted: boolean('encrypted').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Types ───

export type Feed = typeof feeds.$inferSelect;
export type NewFeed = typeof feeds.$inferInsert;
export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type RunStep = typeof runSteps.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Edition = typeof editions.$inferSelect;
export type Setting = typeof settings.$inferSelect;
