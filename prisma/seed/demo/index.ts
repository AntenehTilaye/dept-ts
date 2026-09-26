import type { PrismaClient } from "../../../src/generated/prisma/client";
import { seedDemoPeople } from "./people";
import { seedDemoCourses } from "./courses";
import { seedDemoNotifications } from "./notifications";
import { seedDemoTasks } from "./tasks";
import { seedDemoCampaign } from "./campaign";
import { seedDemoCommittees } from "./committees";

/** Demo data (SEED_DEMO=1): people, sections, courses, offerings, rosters, timetable, committees, tasks. */
export async function seedDemo(db: PrismaClient) {
  const people = await seedDemoPeople(db);
  await seedDemoCourses(db, people);
  await seedDemoNotifications(db);
  await seedDemoCommittees(db);
  await seedDemoTasks(db);
  await seedDemoCampaign(db);
}
