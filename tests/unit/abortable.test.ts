import { describe, expect, it } from "vitest";
import { untilAborted } from "../../src/lib/abortable";

describe("untilAborted: “stop” always ends the wait", () => {
  it("gives the result when it comes", async () => {
    await expect(untilAborted(Promise.resolve(5), new AbortController().signal)).resolves.toBe(5);
    await expect(untilAborted(Promise.reject(new Error("no")), new AbortController().signal)).rejects.toThrow("no");
  });
  it("ends at once on abort, even if the work never finishes", async () => {
    const stop = new AbortController();
    const waiting = untilAborted(new Promise(() => {}), stop.signal);
    stop.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });
  it("ends at once if already aborted", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(untilAborted(new Promise(() => {}), stop.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
