// import { InferSchemaType } from "mongoose";
// import { TopicsSchema } from "../data/models/topics.model";

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
// export type Topic = InferSchemaType<typeof TopicsSchema>;
