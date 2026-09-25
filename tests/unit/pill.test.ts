import { describe, expect, it } from "vitest";
import { pillLook } from "../../src/content/pill";
import { EARS_OFF, type PillUpdate } from "../../src/lib/messages";

const base: PillUpdate = {
  type: "pill:update",
  ears: { ...EARS_OFF, listening: true },
  worker: { working: false, numbers: false, grid: false, listening: true },
  wakeName: "Navi",
  mode: "handsfree",
};
const look = (u: Partial<PillUpdate>) => pillLook({ ...base, ...u });

describe("floating pill", () => {
  it("hides while Navi is asleep or off", () => {
    expect(look({})).toBeNull();
    expect(look({ ears: EARS_OFF, worker: { ...base.worker, listening: false } })).toBeNull();
  });

  it("says it's listening once awake, and just shows a mark in open-mic mode", () => {
    expect(look({ ears: { ...base.ears, awake: true } })).toEqual({ kind: "hint", icon: "bars", text: "Listening…" });
    expect(look({ ears: { ...base.ears, awake: true }, mode: "open" })?.text).toBe("");
  });

  it("puts what's being heard first, then the work, then the reply", () => {
    const busy = { ...base.worker, working: true, detail: "Looking at the page" };
    const reply = { kind: "navi" as const, text: "Done." };
    expect(look({ interim: "scroll", worker: busy, reply })).toMatchObject({ kind: "hear", text: "scroll" });
    expect(look({ worker: busy, reply })).toMatchObject({ kind: "work", icon: "spin", text: "Looking at the page" });
    expect(look({ reply })).toMatchObject({ kind: "reply", text: "Done." });
    expect(look({ reply: { kind: "error", text: "Oops." } })).toMatchObject({ kind: "error" });
  });

  it("shows a mic problem only while Navi is meant to be listening", () => {
    const ears = { ...EARS_OFF, micError: "Mic blocked." };
    expect(look({ ears })).toMatchObject({ kind: "error", text: "Mic blocked." });
    expect(look({ ears, worker: { ...base.worker, listening: false } })).toBeNull();
  });

  it("ignores a stale caption once the mic is off", () => {
    expect(look({ ears: EARS_OFF, interim: "hello" })).toBeNull();
  });
});

describe("floating pill with the grid", () => {
  it("leaves the grid's instructions to the grid, but still shows errors and speech", () => {
    const grid = { ...base.worker, grid: true };
    expect(look({ worker: grid, reply: { kind: "navi", text: "Grid on." } })).toBeNull();
    expect(look({ worker: grid, reply: { kind: "error", text: "No." } })).toMatchObject({ kind: "error" });
    expect(look({ worker: grid, interim: "five" })).toMatchObject({ kind: "hear", text: "five" });
  });
});
