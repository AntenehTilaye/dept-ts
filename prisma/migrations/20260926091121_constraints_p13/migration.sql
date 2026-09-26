/*
  Warnings:

  - Made the column `feature_record_id` on table `course_offering` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "course_offering" ALTER COLUMN "feature_record_id" SET NOT NULL;
