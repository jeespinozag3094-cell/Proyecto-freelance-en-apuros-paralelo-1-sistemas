import { pgTable, serial, text, integer, doublePrecision, bigint, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Define the 'users' table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Define the 'clients' table
export const clients = pgTable('clients', {
  id: text('id').primaryKey(), // Using UUID string to match existing client code
  userId: integer('user_id').references(() => users.id).notNull(),
  rut: text('rut').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  defaultTariff: integer('default_tariff').notNull(),
  onboardingDate: bigint('onboarding_date', { mode: 'number' }),
  lastActiveDate: bigint('last_active_date', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Define the 'projects' table
export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  clientId: text('client_id').references(() => clients.id).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').$type<'ACTIVE' | 'ARCHIVED'>().notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Define the 'sessions' table
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id).notNull(),
  startTime: bigint('start_time', { mode: 'number' }).notNull(),
  endTime: bigint('end_time', { mode: 'number' }).notNull(),
  durationHours: doublePrecision('duration_hours').notNull(),
  tariffCLP: integer('tariff_clp').notNull(),
  documentType: text('document_type').$type<'BOLETA' | 'FACTURA'>().notNull(),
  billingStatus: text('billing_status').$type<'PENDING' | 'ISSUED' | 'PAID' | 'OVERDUE'>().notNull().default('PENDING'),
  issuedAt: bigint('issued_at', { mode: 'number' }),
  paidAt: bigint('paid_at', { mode: 'number' }),
  taxData: jsonb('tax_data').notNull(), // To store full tax calculation structure
  createdAt: timestamp('created_at').defaultNow(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  clients: many(clients),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  user: one(users, {
    fields: [clients.userId],
    references: [users.id],
  }),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, {
    fields: [projects.clientId],
    references: [clients.id],
  }),
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  project: one(projects, {
    fields: [sessions.projectId],
    references: [projects.id],
  }),
}));
