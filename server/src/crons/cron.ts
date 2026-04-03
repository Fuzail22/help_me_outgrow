import { CronJob } from "cron";
import {
  scheduleNotificationsForNextHour,
  sendScheduledNotifications,
} from "../services/events.service";
// todo: check if the timezone needs to be changed to utc
/**
 * Wrapper function to handle errors in service calls
 * @param func The function to be executed in the cron job
 * @returns
 */
const handleCronErrors = (func: () => Promise<void> | {}) => {
  return async () => {
    try {
      await func();
    } catch (err) {
      console.error(`Error in cron job: ${err.message}`, err);
    }
  };
};
/**
 * cron to start scheduler 45th minute of every hour
 */
//todo: add logs on complete
const schedulerJob = CronJob.from({
  cronTime: "0 45 */1 * * *",
  onTick: handleCronErrors(scheduleNotificationsForNextHour),
  start: true,
  timeZone: "UTC+5:30",
});

/**
 * cron to send scheduled notifications every minute for the next minute
 */
const notifierJob = CronJob.from({
  cronTime: "0 */1 * * * *",
  onTick: handleCronErrors(sendScheduledNotifications),
  start: true,
  timeZone: "UTC+5:30",
});

/**
 * cron to remove the previous hour schedules
 */
//todo: add a garbageCollector service
const garbageCollectorJob = CronJob.from({
  cronTime: "0 15 */1 * * *",
  onTick: handleCronErrors(() => {}),
  timeZone: "UTC+5:30",
});
