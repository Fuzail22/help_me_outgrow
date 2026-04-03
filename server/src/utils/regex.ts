import { Days } from "../types/events.types";

const hourRegexString = "(?:[01]\\d|2[0-3])";
const timeRegexString = `${hourRegexString}:[0-5]\\d`;
const hourRegex = new RegExp(`^${hourRegexString}$`);
const timeRegex = new RegExp(`^${timeRegexString}$`);
/**
 * @description For checking if the input follows the format "day hh:mm" format eg: monday 22:45
 */
const dayTimeRegex = new RegExp(
  `^(${Object.values(Days).join("|")}) ${timeRegexString}$`
);

/**
 *
 * @param day Days
 * @param hour \d\d
 * @returns
 */
const buildDayTimeRegex = (day: Days, hour: string) => {
  if (!hourRegex.test(hour)) throw new Error("hour is not in required format");
  const regex = new RegExp(`^${day} ${hour}:([0-5]\\d)$`);
  return regex;
};
export { dayTimeRegex, hourRegex, timeRegex, buildDayTimeRegex };
