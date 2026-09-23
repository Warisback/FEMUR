import { seedDemoMission } from "../lib/db/seed";

seedDemoMission({ clearWorkers: true })
  .then((r) =>
    console.log(
      `Reset: mission ${r.mission} reseeded with ${r.tasks} open tasks; workers cleared except the demo worker.`,
    ),
  )
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
