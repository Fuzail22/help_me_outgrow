import { Schedules } from "../types/events.types";

class SchedulesRepository {
  async insertManySchedules(schedules: Schedules[]) {}
  async findScheduleByTimeStamp() {}
  deleteScheduleByTimeRange() {}
}

export const schedulesRepository = new SchedulesRepository();
