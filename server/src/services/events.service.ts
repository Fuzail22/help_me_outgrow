/**
 * @description To send notification to the specified endpoint
 */

import { schedulesRepository } from "../repositories/schedules.repostiory";
import { NotificationEvent } from "../types/events.types";
import { getUserSubcriptionEndpoint } from "./users.service";

const getNextHourEvents = () => {
  return [];
};
const saveSchedulesToDB = () => {
  schedulesRepository.insertManySchedules();
};
const scheduleNotificationsForNextHour = () => {
  const now = new Date();
  const currentHour = now.getHours();
  //continue here if cuurent hour 24 day should be + 1
  const nextHourEvents = getNextHourEvents();
  if (nextHourEvents.length == 0) return;
  nextHourEvents.forEach((event) => {});

  //todo: compute schedules timestamp based
  saveSchedulesToDB();
};

const getScheduleForNextMinute = () => {};
/**
 * Sends notification and adds failure count to event
 * @param userSubscriptionEndpoint
 * @param quotes
 */
const sendNotificationToUser = (
  userSubscriptionEndpoint: String,
  quotes: [{ eventID: String; quote: String }]
) => {
  //todo:
  // webpush
  //on failure 1.addfailuteCountToEvent using eventID 2. if faiure is due to expiry or user unsubscinbed update user detail for this endpoint to expired
};
const sendScheduledNotifications = () => {
  const nextMinuteschedules = getScheduleForNextMinute();
  //todo: loop through events, get subEndpoint for current user, push quote by quote
  const userSubscription: any[] = getUserSubcriptionEndpoint();
  //todo: sendNotificationToUser using sub and event
};

const removePreviousHourSchedules = () => {};

/**
 * Archives event
 */
const deleteEvent = () => {
  //call DB with eventID otherwise ObjectIDs
};

//todo: P2
const modifyEvent = () => {};

const addEvent = (event: NotificationEvent) => {
  //call db with the event objects passed
};

export {
  addEvent,
  modifyEvent,
  deleteEvent,
  scheduleNotificationsForNextHour,
  sendScheduledNotifications,
  removePreviousHourSchedules,
};
