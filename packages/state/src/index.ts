/**
 * @conshell/state — Public API
 *
 * SQLite durable state: connection, migrations, and typed repositories.
 */

export { openDatabase, openTestDatabase, type DatabaseOptions } from './connection.js';
export { runMigrations, migrations, type Migration } from './migrations/index.js';
export * from './repositories/index.js';
