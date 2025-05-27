import { InferSchemaType } from "mongoose";
import {
  topicsDataSchema,
  topicsSchema,
} from "../repositories/models/topics.model";
import { notificationEventsSchema } from "../repositories/models/events.model";

export enum TopicType {
  RELATIONSHIP = "relationship",
  FRIENDSHIP = "friendship",
  LEADERSHIP = "leadership",
}

export enum Days {
  MONDAY = "monday",
  TUESDAY = "tuesday",
  WEDNESDAY = "wednesday",
  THURSDAY = "thursday",
  FRIDAY = "friday",
  SATURDAY = "saturday",
  SUNDAY = "sunday",
}
export type Topic = InferSchemaType<typeof topicsSchema>;
export type TopicData = InferSchemaType<typeof topicsDataSchema>;
export type NotificationEvent = InferSchemaType<
  typeof notificationEventsSchema
>;
