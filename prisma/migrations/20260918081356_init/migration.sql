-- CreateEnum
CREATE TYPE "setting_scope" AS ENUM ('global', 'department', 'program');

-- CreateTable
CREATE TABLE "system_setting" (
    "key" TEXT NOT NULL,
    "scope" "setting_scope" NOT NULL,
    "scope_id" TEXT NOT NULL DEFAULT '',
    "value_json" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_setting_pkey" PRIMARY KEY ("key","scope","scope_id")
);
