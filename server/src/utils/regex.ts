import { Days } from "../types/events.types";

/**
 * @description For checking if the input follows the format "day hh:mm" format eg: MONDAY 22:45
 */
const dayTimeRegex = new RegExp(
  `^(${Object.values(Days).join("|")}) ([01]\d|2[0-3]:[0-5]\d)$`
);
const timeRegex = new RegExp("^[01]d|2[0-3]:[0-5]d$");

export { dayTimeRegex, timeRegex };
