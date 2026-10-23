import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export type ShopDb = DatabaseSync;

export function openDatabase(path: string): ShopDb {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    INSERT INTO counters (name, value) VALUES ('order', 1000)
      ON CONFLICT(name) DO NOTHING;

    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      status TEXT NOT NULL,
      session_id TEXT UNIQUE,
      checkout_url TEXT,
      lines TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      shipping_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      number TEXT UNIQUE NOT NULL,
      reservation_id TEXT UNIQUE,
      session_id TEXT UNIQUE NOT NULL,
      payment_intent_id TEXT,
      lines TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      shipping_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      email TEXT,
      contact_name TEXT,
      phone TEXT,
      shipping_name TEXT,
      address_json TEXT,
      payment_status TEXT NOT NULL,
      fulfilment_status TEXT NOT NULL,
      fulfilment_note TEXT,
      fulfilled_at TEXT,
      review_status TEXT NOT NULL,
      review_reason TEXT,
      livemode INTEGER NOT NULL,
      notification TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      event_id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );
  `);
  return db;
}

export function transaction<T>(db: ShopDb, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw error;
  }
}

export function get<T>(stmt: StatementSync, ...params: SQLInputValue[]): T | undefined {
  return stmt.get(...params) as T | undefined;
}

export function all<T>(stmt: StatementSync, ...params: SQLInputValue[]): T[] {
  return stmt.all(...params) as T[];
}
