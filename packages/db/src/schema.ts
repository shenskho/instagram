import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, real, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { StyleSettings, TranscriptSegment, EditPlan, VideoStatus, Clip, Selection } from "@autoreel/shared";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

/** Page style rules (one row per user). */
export const styleSettings = pgTable("style_settings", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<StyleSettings>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const videos = pgTable("videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").$type<VideoStatus>().notNull().default("uploaded"),
  stage: text("stage"),                 // human readable sub-step
  progress: integer("progress").notNull().default(0), // 0..100 within the current status
  sourcePath: text("source_path").notNull(), // relative to STORAGE_DIR
  duration: real("duration"),
  width: integer("width"),
  height: integer("height"),
  analysis: jsonb("analysis").$type<Record<string, unknown>>(), // summary (camera, pauses, ...)
  clips: jsonb("clips").$type<Clip[]>(),          // set when several files were uploaded and joined
  pov: text("pov").notNull().default(""),         // the creator's angle on the video
  description: text("description").notNull().default(""), // what happens on screen (needed when nobody speaks)
  options: jsonb("options").$type<Selection[]>().notNull().default([]), // edit options that must appear (+ their details)
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("videos_user_idx").on(t.userId, t.createdAt)]);

export const transcripts = pgTable("transcripts", {
  videoId: uuid("video_id").primaryKey().references(() => videos.id, { onDelete: "cascade" }),
  engine: text("engine").notNull(),
  segments: jsonb("segments").$type<TranscriptSegment[]>().notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every edit plan the director wrote (versioned; revisions keep history). */
export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  videoId: uuid("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  source: text("source").notNull(),      // rule | claude | manual
  note: text("note"),                    // user's revision note that produced this plan
  plan: jsonb("plan").$type<EditPlan>().notNull(),
  planPath: text("plan_path").notNull(), // relative to STORAGE_DIR
  validation: jsonb("validation").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("plans_video_version_idx").on(t.videoId, t.version)]);

export const renders = pgTable("renders", {
  id: uuid("id").primaryKey().defaultRandom(),
  videoId: uuid("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("rendering"), // rendering | done | failed
  outputPath: text("output_path"),
  qcPath: text("qc_path"),
  duration: real("duration"),
  elapsedS: real("elapsed_s"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("renders_video_idx").on(t.videoId, t.createdAt)]);
