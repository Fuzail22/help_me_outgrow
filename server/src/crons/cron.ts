import { CronJob } from "cron";
import {
  scheduleNotificationsForNextHour,
  sendScheduledNotifications,
} from "../services/events.service";

/**
 * cron to start scheduler 45th minute of every hour
 */
//todo: add logs on complete
const schedulerJob = CronJob.from({
  cronTime: "0 45 */1 * * *",
  onTick: scheduleNotificationsForNextHour,
  start: true,
  timeZone: "UTC+5:30",
});

/**
 * cron to send scheduled notifications every minute for the next minute
 */
const notifierJob = CronJob.from({
  cronTime: "0 */1 * * * *",
  onTick: sendScheduledNotifications,
  start: true,
  timeZone: "UTC+5:30",
});

/**
 * cron to remove the previous hour schedules
 */
//todo: add a garbageCollector service
const garbageCollectorJob = CronJob.from({
  cronTime: "0 15 */1 * * *",
  onTick: () => {},
  timeZone: "UTC+5:30",
});
