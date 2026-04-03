import { ObjectId } from "mongoose";
import { notificationEvent } from "./models/events.model";
import { NotificationEvent } from "../types/events.types";

class NotificationEventsRepository {
  //todo: if mongoDB fully managed version doesn't support $regex operator use full text search
  /**
   *
   * @param date returns next hour events with times field filtered with next hour events
   * @param dayTimeRegex
   * @returns
   */
  async findnextHourEvents(
    date: Date,
    dayTimeRegex: RegExp
  ): Promise<NotificationEvent[]> {
    return await notificationEvent.aggregate([
      {
        //todo: need to verify how comparison happens, is it without conversion to locale in both input and output
        $match: {
          start_date: { $lte: date },
          end_date: { $gte: date },
          times: { $regex: dayTimeRegex },
        },
      },
      // todo: remove before commit
      // {
      //   $project: {
      //     times: {
      //       $filter: {
      //         input: "$times",
      //         as: "time",
      //         cond: {
      //           $regexMatch: { input: "$$time", regex: dayTimeRegex },
      //         },
      //       },
      //     },
      //   },
      // },
    ]);
  }
  async findEventbyID(eventId: ObjectId): Promise<NotificationEvent> {
    return await notificationEvent.findById(eventId);
  }
}
export const notificationEventsRepository = new NotificationEventsRepository();
