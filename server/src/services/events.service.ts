/**
 * @description To send notification to the specified endpoint
 */

import { notificationEventsRepository } from "../repositories/events.repository";
import { schedulesRepository } from "../repositories/schedules.repostiory";
import { topicsRepository } from "../repositories/topics.repository";
import { Days, NotificationEvent, Schedules } from "../types/events.types";
import { getUTCDateObject } from "../utils/date";
import { buildDayTimeRegex } from "../utils/regex";
import { getUserSubcriptionEndpoint } from "./users.service";

const getNextHourEvents = () => {
  return [];
};
const saveSchedulesToDB = () => {
  // schedulesRepository.insertManySchedules();
};

/**
 * Returns the current date, day and next hour, if next hour is new day returns the next date, day and hour
 */
const getDateDayAndNextHour = () => {
  let date = new Date();
  let dateUTC = getUTCDateObject();
  let dayIndex = dateUTC.day;
  let hour: number | string = Number((dateUTC.hours + 1) % 24);
  date.setUTCHours(hour);
  if (hour == 0) {
    dayIndex = (dayIndex + 1) % 7;
    date.setUTCDate(dateUTC.date + 1);
  }
  if (hour < 10) {
    hour = "0" + String(hour);
  } else {
    hour = String(hour);
  }

  const day = Object.values(Days)[dayIndex];
  return { date, day, hour };
};

/**
 * Return an object with numerics days as keys the number of event occuerrences on a given day
 * @param times
 * @returns {}
 */
const findDayOccurrences = (times: []) => {
  let dayOccurrences = {};
  times.forEach((dayTime) => {
    const day = extractDayFromDayTime(dayTime);
    const dayIndex = Object.values(Days).indexOf(day as Days);
    if (dayOccurrences[day]) dayOccurrences[day]++;
    else dayOccurrences[day] = 1;
  });
  return dayOccurrences;
};

const findEventOccurrences = (start_date, Occurrences_date, times) => {
  let dayOccurrencess = findDayOccurrences(times);
  let date = start_date;
  let occurrence = 0;
  while (date < Occurrences_date) {
    const day = date.getDay();
    if (dayOccurrencess[day] != undefined) {
      occurrence += dayOccurrencess[day];
    }
    date.setDate(date + 1);
  }
  return occurrence;
};

const extractDayFromDayTime = (dayTime) => {
  const day = dayTime.split(" ")[0];
  return day;
};

const extractTimeFromDayTime = (dayTime) => {
  const time = dayTime.split(" ")[1];
  return time;
};

const extractHourMinuteFromDayTime = (dayTime) => {
  const [hour, min] = dayTime.split(" ")[1].split(":");
  return { hour, min };
};

// continue here testing with latest timestamp changes why content is undefined
const scheduleNotificationsForNextHour = async () => {
  const notificationsToBeScheduledForNextHour: Schedules[] = [];
  const { date, day, hour } = getDateDayAndNextHour();
  const scheduleTimestampDate: Date = structuredClone(date);
  const dayTimeRegex = buildDayTimeRegex(day, hour);
  const nextHourEvents: NotificationEvent[] =
    await notificationEventsRepository.findnextHourEvents(date, dayTimeRegex);
  // todo: add proper error message
  if (nextHourEvents.length == 0) return { success: false };
  nextHourEvents.forEach((event) => {
    const times = event.times;
    let occurrence;
    let userEvent;
    times.forEach((dayTime) => {
      if (!dayTimeRegex.test(dayTime)) return;
      if (!occurrence) {
        occurrence = findEventOccurrences(event.start_date, date, times);
      } else {
        occurrence++;
      }
      // const notificationTime = extractTimeFromDayTime(dayTime);
      const { hour, min } = extractHourMinuteFromDayTime(dayTime);
      scheduleTimestampDate.setUTCHours(hour, min, 0, 0);
      const quote = topicsRepository.findTopicQuoteByIndex(
        event.topic,
        occurrence == 0 ? 0 : occurrence - 1
      );
      let schedule = notificationsToBeScheduledForNextHour.find(
        (schedule) => schedule.timeStamp === scheduleTimestampDate
      );
      console.log(schedule?.events);
      if (schedule) {
        userEvent = schedule.events.find(
          (scheduleEvent) => scheduleEvent.userId === event.userId
        );
        userEvent.content.push({ eventId: event._id, quote });
      } else {
        userEvent = {
          userId: event.userId,
          content: [{ eventId: event._id, quote }],
        };
        schedule = {
          timeStamp: scheduleTimestampDate,
          events: [userEvent],
        } as Schedules;
        notificationsToBeScheduledForNextHour.push(schedule);
      }
    });
  });
  if (notificationsToBeScheduledForNextHour.length == 0)
    return { success: false };
  schedulesRepository.insertManySchedules(
    notificationsToBeScheduledForNextHour
  );
};

const getScheduleForNextMinute = () => {};
/**
 * Sends notification and adds failure count to event
 * @param userSubscriptionEndpoint
 * @param quotes
 */
const sendNotificationToUser = (
  userSubscriptionEndpoint: String,
  quotes: [{ eventId: String; quote: String }]
) => {
  //todo:
  // webpush
  //on failure 1.addfailuteCountToEvent using eventId 2. if faiure is due to expiry or user unsubscinbed update user detail for this endpoint to expired
};
const sendScheduledNotifications = () => {
  const nextMinuteschedules = getScheduleForNextMinute();
  //todo: loop through events, get subEndpoint for current user, push quote by quote
  const userSubscription = getUserSubcriptionEndpoint();
  //todo: sendNotificationToUser using sub and event
};

const removePreviousHourSchedules = () => {};

/**
 * Archives event
 */
const deleteEvent = () => {
  //call DB with eventId otherwise ObjectIDs
};

//todo: P2
const modifyEvent = () => {};

const addEvent = (event: NotificationEvent) => {
  //call db with the event objects passed
};

// continue here, exporitng certain functions additionally for testing with required nomenclature
export {
  addEvent,
  modifyEvent,
  deleteEvent,
  scheduleNotificationsForNextHour,
  sendScheduledNotifications,
  removePreviousHourSchedules,
};

export const __test__ = {
  getDateDayAndNextHour,
  extractDayFromDayTime,
  extractTimeFromDayTime,
  findDayOccurrences,
};
