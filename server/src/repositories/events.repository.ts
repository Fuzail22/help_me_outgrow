import { notificationEvent } from "./models/events.model";

class EventsRepository {
  findnextHourEvents(now) {
    notificationEvent.find({ start_date: { $lte: now } });
    //continue here p1
  }
}

const eventsRepository = new EventsRepository();
