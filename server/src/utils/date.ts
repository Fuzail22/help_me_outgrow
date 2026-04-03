/**
 * returns custom date object with all values in UTC
 */
const getUTCDateObject = (inputDate: Date | null = null) => {
  const date = inputDate ? new Date(inputDate) : new Date();
  return {
    day: date.getUTCDay(),
    date: date.getUTCDate(),
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    hours: date.getUTCHours(),
    minutes: date.getUTCMinutes(),
    seconds: date.getUTCSeconds(),
    milliseconds: date.getUTCMilliseconds(),
  };
};

export { getUTCDateObject };
