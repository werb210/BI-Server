import { MigrationBuilder } from "node-pg-migrate";

export async function up(pgm: MigrationBuilder) {

  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.createTable("bi_companies", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text", notNull: true },
    created_at: { type: "timestamp", default: pgm.func("now()") }
  });

  pgm.createTable("bi_contacts", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    company_id: { type: "uuid", references: "bi_companies", onDelete: "cascade" },
    name: { type: "text" },
    email: { type: "text" },
    phone: { type: "text" },
    created_at: { type: "timestamp", default: pgm.func("now()") }
  });

  pgm.createTable("bi_applications", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    company_id: { type: "uuid", references: "bi_companies" },
    contact_id: { type: "uuid", references: "bi_contacts" },
    stage: { type: "text", notNull: true, default: "draft" },
    premium_calc: { type: "jsonb" },
    bankruptcy_flag: { type: "boolean", default: false },
    created_by_lender_id: { type: "uuid" },
    created_at: { type: "timestamp", default: pgm.func("now()") }
  });

  pgm.createTable("bi_documents", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    application_id: { type: "uuid", references: "bi_applications", onDelete: "cascade" },
    filename: { type: "text" },
    storage_path: { type: "text" },
    uploaded_at: { type: "timestamp", default: pgm.func("now()") },
    purged: { type: "boolean", default: false }
  });

  pgm.createTable("bi_activity", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    application_id: { type: "uuid", references: "bi_applications", onDelete: "cascade" },
    actor_type: { type: "text" },
    description: { type: "text" },
    created_at: { type: "timestamp", default: pgm.func("now()") }
  });

  pgm.createTable("bi_commissions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    application_id: { type: "uuid", references: "bi_applications", onDelete: "cascade" },
    estimated_amount: { type: "numeric" },
    received: { type: "boolean", default: false },
    created_at: { type: "timestamp", default: pgm.func("now()") }
  });

  pgm.createTable("bi_purge_queue", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    application_id: { type: "uuid", references: "bi_applications", onDelete: "cascade" },
    purge_after: { type: "timestamp", notNull: true }
  });

  pgm.createTable("bi_lenders", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text" },
    email: { type: "text" },
    created_at: { type: "timestamp", default: pgm.func("now()") }
  });

  pgm.createTable("bi_referrers", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    name: { type: "text" },
    email: { type: "text" },
    created_at: { type: "timestamp", default: pgm.func("now()") }
  });

  pgm.createTable("bi_referrals", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    referrer_id: { type: "uuid", references: "bi_referrers", onDelete: "cascade" },
    contact_name: { type: "text" },
    contact_email: { type: "text" },
    contact_phone: { type: "text" },
    created_at: { type: "timestamp", default: pgm.func("now()") }
  });

  pgm.createIndex("bi_applications", "stage");
  pgm.createIndex("bi_documents", "application_id");
  pgm.createIndex("bi_activity", "application_id");
}

export async function down(pgm: MigrationBuilder) {

  pgm.dropTable("bi_referrals");
  pgm.dropTable("bi_referrers");
  pgm.dropTable("bi_lenders");
  pgm.dropTable("bi_purge_queue");
  pgm.dropTable("bi_commissions");
  pgm.dropTable("bi_activity");
  pgm.dropTable("bi_documents");
  pgm.dropTable("bi_applications");
  pgm.dropTable("bi_contacts");
  pgm.dropTable("bi_companies");

}
