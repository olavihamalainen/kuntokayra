// Synthetic records for regression tests; no real user data.
import { plain } from "./browser-harness.mjs";

export const ex = (name, weight, reps = 8) => ({
  name,
  sets: [{ weight, reps }],
});
export const workout = (id, date, category, exercises, savedAt) => ({
  id,
  date,
  ...(category ? { category } : {}),
  exercises,
  ...(savedAt ? { savedAt } : {}),
});
export const legacy = {
  workouts: [
    workout("legacy", "2026-11-01", null, [
      ex("Penkkipunnerrus", 30),
      ex("Maastaveto", 80),
    ]),
  ],
  sleep: [
    { id: "s", date: "2026-11-02", bed: "22:30", wake: "06:30", duration: 8 },
  ],
  weight: [{ id: "w", date: "2026-11-02", value: 75.5 }],
};
export const history = {
  ...plain(legacy),
  workouts: [
    ...plain(legacy.workouts),
    workout(
      "f1",
      "2026-11-10",
      "Etukroppa",
      [ex("Penkkipunnerrus", 40), ex("Hauiskääntö", 12)],
      "2026-11-10T10:00:00.000Z",
    ),
    workout(
      "f2",
      "2026-11-13",
      "Etukroppa",
      [
        ex("Pystypunnerrus", 25),
        {
          name: "Penkkipunnerrus",
          sets: [
            { weight: 55, reps: 8 },
            { weight: 70, reps: 5 },
          ],
        },
      ],
      "2026-11-13T10:00:00.000Z",
    ),
    workout(
      "b1",
      "2026-11-14",
      "Takakroppa",
      [ex("Kulmasoutu", 60), ex("Leuanveto", 0)],
      "2026-11-14T10:00:00.000Z",
    ),
    workout(
      "saved-last",
      "2026-11-05",
      "Etukroppa",
      [ex("Penkkipunnerrus", 20)],
      "2026-11-16T10:00:00.000Z",
    ),
  ],
};
