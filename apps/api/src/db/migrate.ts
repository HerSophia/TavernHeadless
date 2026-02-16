import { createDatabase } from "./client";

const databasePath = process.env.DATABASE_URL ?? "data/tavern-headless.db";

const connection = createDatabase(databasePath);
connection.close();

console.log(`Migrations applied: ${databasePath}`);
