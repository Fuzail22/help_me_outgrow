import { InferSchemaType } from "mongoose";
import {
  topicsDataSchema,
  topicsSchema,
} from "../repositories/models/topics.model";
import { notificationEventsSchema } from "../repositories/models/events.model";
import {
  Schedules,
  schedulesSchema,
} from "../repositories/models/schedules.model";

export enum TopicType {
  RELATIONSHIP = "relationship",
  FRIENDSHIP = "friendship",
  LEADERSHIP = "leadership",
}

export enum Days {
  SUNDAY = "sunday",
  MONDAY = "monday",
  TUESDAY = "tuesday",
  WEDNESDAY = "wednesday",
  THURSDAY = "thursday",
  FRIDAY = "friday",
  SATURDAY = "saturday",
}
export type Topic = InferSchemaType<typeof topicsSchema>;
export type TopicData = InferSchemaType<typeof topicsDataSchema>;
export type NotificationEvent = InferSchemaType<
  typeof notificationEventsSchema
>;
export type Schedules = InferSchemaType<typeof schedulesSchema>;
