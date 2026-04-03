import { notificationEventsRepository } from "../../../src/repositories/events.repository";
import { schedulesRepository } from "../../../src/repositories/schedules.repostiory";
import { topicsRepository } from "../../../src/repositories/topics.repository";
import {
  __test__,
  scheduleNotificationsForNextHour,
} from "../../../src/services/events.service";

jest.mock("../../../src/repositories/events.repository");
jest.mock("../../../src/repositories/schedules.repostiory");
jest.mock("../../../src/repositories/topics.repository");

const {
  extractDayFromDayTime,
  getDateDayAndNextHour,
  extractTimeFromDayTime,
  findDayOccurrences,
} = __test__;
describe("events.service", () => {
  describe("getDateDayAndNextHour", () => {
    it.each([
      [
        "2025-08-25T00:15:00Z",
        new Date("2025-08-25T01:15:00Z"),
        "monday",
        "01",
      ],
      [
        "2025-08-25T10:30:00Z",
        new Date("2025-08-25T11:30:00Z"),
        "monday",
        "11",
      ],
      [
        "2025-08-25T11:59:59Z",
        new Date("2025-08-25T12:59:59Z"),
        "monday",
        "12",
      ],
    ])(
      "should return next hour with same day since hours aren't 23",
      (inputDate, expectedDate, expectedDay, expectedHour) => {
        jest.useFakeTimers().setSystemTime(new Date(inputDate));
        const { date, day, hour } = getDateDayAndNextHour();
        expect(JSON.stringify(date)).toBe(JSON.stringify(expectedDate));
        expect(day).toBe(expectedDay);
        expect(hour).toBe(expectedHour);
      }
    );

    it.each([
      [
        "2025-08-25T23:00:00Z",
        new Date("2025-08-26T00:00:00Z"),
        "tuesday",
        "00",
      ],
      [
        "2025-08-31T23:15:00Z",
        new Date("2025-09-01T00:15:00Z"),
        "monday",
        "00",
      ],
      [
        "2025-02-28T23:59:59Z",
        new Date("2025-03-01T00:59:59Z"),
        "saturday",
        "00",
      ],
    ])(
      "should roll over to next day at night hours 23",
      (inputDate, expectedDate, expectedDay, expectedHour) => {
        jest.useFakeTimers().setSystemTime(new Date(inputDate));
        const { date, day, hour } = getDateDayAndNextHour();
        expect(JSON.stringify(date)).toBe(JSON.stringify(expectedDate));
        expect(day).toBe(expectedDay);
        expect(hour).toBe(expectedHour);
      }
    );
  });

  describe("extractDayFromDayTime", () => {
    it("should extract day correctly", () => {
      expect(extractDayFromDayTime("monday 10:00")).toBe("monday");
      expect(extractDayFromDayTime("monday 10:00")).toBe("monday");
      expect(extractDayFromDayTime("wednesday 10:00")).toBe("wednesday");
    });
  });

  describe("extractTimeFromDayTime", () => {
    it("should extract time correctly", () => {
      expect(extractTimeFromDayTime("monday 10:00")).toBe("10:00");
      expect(extractTimeFromDayTime("monday 00:30")).toBe("00:30");
      expect(extractTimeFromDayTime("wednesday 23:04")).toBe("23:04");
    });
  });

  describe("findDayOoccurrences", () => {
    it("should count occurrences of days in times list", () => {
      const times = ["monday 10:00", "monday 15:00", "tuesday 09:00"];
      const result = findDayOccurrences(times as any);
      expect(result).toMatchObject({ monday: 2, tuesday: 1 });
    });
  });

  // continue here checking other functions have been added to test then move on to schedule notification for next hour

  describe("scheduleNotificationsForNextHour", () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date("2025-08-25T10:30:00Z"));
      jest.resetAllMocks();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // it("should return {success:false} if no events found", async () => {
    //   (
    //     notificationEventsRepository.findnextHourEvents as jest.Mock
    //   ).mockResolvedValue([]);
    //   const result = await scheduleNotificationsForNextHour();
    //   expect(result).toEqual({ success: false });
    // });

    it("should insert schedules if events are found", async () => {
      (
        notificationEventsRepository.findnextHourEvents as jest.Mock
      ).mockResolvedValue([
        {
          _id: "evt1",
          userId: "user1",
          start_date: new Date("2025-08-23T00:00:00Z"),
          end_date: new Date("2025-09-01T00:00:00Z"),
          topic: "motivation",
          times: ["monday 11:00", "wednesday 14:00"],
          media_type: "text",
          failureCount: 0,
        },
        {
          _id: "evt2",
          userId: "user2",
          start_date: new Date("2025-08-24T00:00:00Z"),
          end_date: new Date("2025-09-10T00:00:00Z"),
          topic: "wellness",
          times: ["monday 11:20", "sunday 09:00"],
          media_type: "text",
          failureCount: 0,
        },
        {
          _id: "evt3",
          userId: "user3",
          start_date: new Date("2025-08-25T00:00:00Z"),
          end_date: new Date("2025-09-15T00:00:00Z"),
          topic: "productivity",
          times: ["tuesday 16:00", "saturday 11:59"],
          media_type: "text",
          failureCount: 0,
        },
      ]);

      (topicsRepository.findTopicQuoteByIndex as jest.Mock).mockImplementation(
        (topic, index) => {
          const quotes = {
            motivation: ["Stay strong!", "Keep pushing!", "You got this!"],
            wellness: ["Drink water!", "Take deep breaths!", "Rest well!"],
            productivity: ["Focus now!", "One task at a time!", "Plan ahead!"],
          };
          return quotes[topic][index % quotes[topic].length];
        }
      );
      (schedulesRepository.insertManySchedules as jest.Mock).mockResolvedValue(
        true
      );

      await scheduleNotificationsForNextHour();
      // continue here adding expectation for insertmany schedules or breakdown the finnding nexthour events into smaller unit to test it out individually
      expect(
        notificationEventsRepository.findnextHourEvents
      ).toHaveBeenCalled();
      expect(schedulesRepository.insertManySchedules).toHaveBeenCalledWith([
        {
          timeStamp: "2025-08-25T11:00:00Z",
          events: [
            {
              userId: "user1",
              content: [{ eventId: "evt1", quote: "Stay strong!" }],
            },
          ],
        },
        {
          timeStamp: "2025-08-25T11:20:00Z",
          events: [
            {
              userId: "user2",
              content: [{ eventId: "evt2", quote: "Take deep breaths!" }],
            },
          ],
        },
      ]);
    });
  });
});
