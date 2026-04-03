import { Days } from "../../../src/types/events.types";
import {
  dayTimeRegex,
  timeRegex,
  buildDayTimeRegex,
  hourRegex,
} from "../../../src/utils/regex";

describe("regex utilities", () => {
  describe("hourRegex", () => {
    it("should match valid hour only", () => {
      expect(hourRegex.test("22")).toBe(true);
      expect(hourRegex.test("00")).toBe(true);
    });

    it("should reject invalid hours", () => {
      expect(hourRegex.test("25")).toBe(false);
      expect(hourRegex.test("0")).toBe(false);
      expect(hourRegex.test("9")).toBe(false);
    });
  });
  describe("timeRegex", () => {
    it("should match valid time only", () => {
      expect(timeRegex.test("22:45")).toBe(true);
      expect(timeRegex.test("00:00")).toBe(true);
    });

    it("should reject invalid times", () => {
      expect(timeRegex.test("25:00")).toBe(false);
      expect(timeRegex.test("09:60")).toBe(false);
      expect(timeRegex.test("9:00")).toBe(false);
    });
  });
  describe("dayTimeRegex", () => {
    it("should match valid day and time", () => {
      expect(dayTimeRegex.test("monday 22:45")).toBe(true);
      expect(dayTimeRegex.test("friday 09:00")).toBe(true);
    });

    it("should reject invalid day", () => {
      expect(dayTimeRegex.test("FUNDAY 22:45")).toBe(false);
      expect(dayTimeRegex.test("frriday 12:00")).toBe(false);
    });

    it("should reject invalid time", () => {
      expect(dayTimeRegex.test("monday 25:00")).toBe(false);
      expect(dayTimeRegex.test("tuesday 22:99")).toBe(false);
      expect(dayTimeRegex.test("tuesday 2:45")).toBe(false);
    });
  });

  describe("buildDayTimeRegex", () => {
    it("should return regex that matches the given day/hour", () => {
      const regex = buildDayTimeRegex(Days.MONDAY, "22");
      expect(regex.test("monday 22:00")).toBe(true);
      expect(regex.test("monday 22:30")).toBe(true);
      expect(regex.test("monday 22:59")).toBe(true);
    });

    it("should reject times outside the hour", () => {
      const regex = buildDayTimeRegex(Days.MONDAY, "22");
      expect(regex.test("monday 23:30")).toBe(false);
      expect(regex.test("monday 21:00")).toBe(false);
    });

    it("should throw error for invalid hour", () => {
      expect(() => buildDayTimeRegex(Days.MONDAY, "25")).toThrow(
        "hour is not in required format"
      );
    });
  });
});
