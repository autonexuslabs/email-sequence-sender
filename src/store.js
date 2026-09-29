// store.js — leads, suppression list and send log in one JSON file.
//
// Writes are atomic (write a temp file, then rename), so a run killed halfway
// never leaves a half-written store. For Cloud Run, swap this module for one
// backed by Firestore or Redis with the same four functions.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'

const EMPTY = { leads: [], suppressed: [], log: [] }

export function load(file) {
  if (!existsSync(file)) return structuredClone(EMPTY)
  return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(file, 'utf8')) }
}

export function save(file, db) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n')
  renameSync(tmp, file)
}

export const suppressedSet = (db) => new Set(db.suppressed.map((s) => s.email.toLowerCase()))

export function suppress(db, email, reason, date) {
  const e = email.toLowerCase()
  if (!db.suppressed.some((s) => s.email === e)) db.suppressed.push({ email: e, reason, date })
}
