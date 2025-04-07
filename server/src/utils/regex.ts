import { Days } from "../types/events.types";

const dayTimeRegex = new RegExp(
  `^(${Object.values(Days).join("|")}) ([01]\d|2[0-3]:[0-5]\d)$`
);
// console.log({ dayTimeRegex });

export { dayTimeRegex };
