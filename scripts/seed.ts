import { seedDemoMission } from "../lib/db/seed";

seedDemoMission()
  .then((r) => console.log(`Seeded mission ${r.mission} with ${r.tasks} open tasks.`))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
