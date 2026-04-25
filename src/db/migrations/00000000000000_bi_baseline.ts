import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder) {
  pgm.createExtension("pgcrypto", { ifNotExists: true });
}

export async function down() {}
