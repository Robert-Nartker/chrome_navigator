// The first-run tutorial: a short spoken tour. Navi says a step, the user does it for real (by voice),
// and Navi moves on when it sees the command work. It needs no screen and no hands: "next", "repeat"
// and "end tutorial" work by voice, and the side panel shows the same steps with buttons for those who
// prefer them. One question tailors it: whether Navi should say out loud everything it does (for people
// who can't see the screen well), which also sets that preference.

export interface TutorialContext {
  /** The wake name ("Navi"). */
  name: string;
  /** Open-mic mode: no wake name needed. */
  openMic: boolean;
  /** An AI is set up (Pro with a key, or Free with the on-device model ready). */
  ai: boolean;
  /** Navi says out loud everything it does (the user can't see the screen well). */
  screenFree: boolean;
}

/** A command that ran while the tutorial was on: what was said, and what Navi made of it. */
export interface TutorialEvent {
  command: string;
  intent?: string;
  /** "ai" when the AI handled it. */
  path?: string;
}

export interface TutorialStep {
  id: string;
  /** A few words, for the panel. */
  title: string;
  /** What Navi says. */
  say: string;
  /** The step is done when this happens. A step without it is the yes/no question. */
  done?: (e: TutorialEvent) => boolean;
  /** Said when the step is done, before the next one. */
  praise?: string;
  /** Navi goes to sleep after saying it (to practice waking it). */
  sleepAfter?: boolean;
}

export interface TutorialView {
  step: number;
  total: number;
  title: string;
  text: string;
  /** The step is the yes/no question. */
  question: boolean;
}

const is =
  (...intents: string[]) =>
  (e: TutorialEvent) =>
    !!e.intent && intents.includes(e.intent);

export function tutorialSteps(c: TutorialContext): TutorialStep[] {
  const alias = c.name.toLowerCase() === "navi" ? ` “Hey Navigator” works too.` : "";
  const steps: TutorialStep[] = [
    {
      id: "intro",
      title: "Welcome",
      say: `Hi, I'm ${c.name}. This tour takes about two minutes. Say “next” to skip a step, “repeat” to hear it again, or “end tutorial” to stop. First, a question: would you like me to say out loud everything I do? It helps if you can't see the screen well. Say yes or no.`,
    },
    c.openMic
      ? {
          id: "wake",
          title: "Give a command",
          say: "In open mic mode I'm always listening, so just say the command. Try: open Wikipedia.",
          done: is("open", "search"),
          praise: "That's it.",
        }
      : {
          id: "wake",
          title: "Wake me up",
          say: `I'm going to sleep now. To wake me, say my name and the command together. Try: Hey ${c.name}, open Wikipedia.`,
          done: is("open", "search"),
          praise: `That's how you wake me.${alias} After that I stay awake while you keep talking, so you don't need my name again until I fall asleep.`,
          sleepAfter: true,
        },
    {
      id: "scroll",
      title: "Scroll",
      say: "Now say: scroll down.",
      done: is("scroll", "autoScroll"),
      praise: "You can also say scroll up, page down, or go to the top.",
    },
  ];
  if (c.screenFree) {
    steps.push({
      id: "describe",
      title: "Hear what's on screen",
      say: "To hear what's on the screen, say: describe the screen.",
      done: is("describeScreen", "whereAmI", "readPage"),
      praise: "To click something, say click and its name, like “click search”. “Where am I” tells you the page you're on.",
    });
  } else {
    steps.push({
      id: "click",
      title: "Click",
      say: "To click something, say click and its name, or say “show numbers”: every link and button gets a number, and you say the number. Try it: show numbers, then say a number.",
      done: is("clickNumber", "clickText", "hideNumbers"),
      praise: "For spots without a number, say “show grid”, then numbers to zoom in.",
    });
  }
  steps.push(
    {
      id: "search",
      title: "Search",
      say: "To search, say “search for” and what you want. Try: search for octopus.",
      done: is("search", "siteSearch"),
      praise: "I search the site you're on when it has a search, otherwise the web.",
    },
    {
      id: "back",
      title: "Go back",
      say: "Say: go back.",
      done: is("back", "backN"),
      praise: "",
    },
    {
      id: "stop",
      title: "Interrupt me",
      say: "I can read pages to you. Say “read this page”, and when you've heard enough, say “stop”. Stop works any time I'm talking or busy.",
      done: is("stop"),
      praise: "Good.",
    },
  );
  if (c.ai) {
    steps.push({
      id: "ask",
      title: "Ask anything",
      say: "You can also ask me anything, or give me a bigger job in your own words. Try: what is this page about?",
      done: (e) => e.path === "ai",
      praise: "",
    });
  }
  steps.push({
    id: "finish",
    title: "Sleep and settings",
    say: `Last thing. When you're done, say “go to sleep”, and I'll wait for my name. “Turn off” stops me listening completely. Say “what can I say” any time for ideas, “open settings” for settings, and “start the tutorial” to take this tour again. Say “go to sleep” now to finish.`,
    done: is("sleep", "turnOff"),
    praise: "That's the tour. Have fun.",
  });
  return steps;
}

export type TutorialControl = "next" | "repeat" | "end" | "yes" | "no";

/** "next", "repeat", "end tutorial", and yes or no for the question. */
export function parseTutorialControl(text: string, question: boolean): TutorialControl | null {
  const t = text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:(?:end|stop|exit|quit|close|cancel|finish|leave|skip)(?: the)? (?:tutorial|tour)|no more tutorial)$/.test(t)) return "end";
  if (/^(?:ok(?:ay)? )?(?:next(?: step| one)?|skip(?: this| that| it)?(?: step)?|go on|continue|keep going)$/.test(t)) return "next";
  if (/^(?:repeat(?: that| it| the step)?|again|say (?:that|it) again|what did you say|come again|pardon)$/.test(t)) return "repeat";
  if (question) {
    if (/^(?:yes|yeah|yep|yup|sure|please|okay|ok|definitely|absolutely)\b/.test(t)) return "yes";
    if (/^(?:no|nope|nah|not really|no thanks?)\b/.test(t)) return "no";
  }
  return null;
}

export class Tutorial {
  private steps: TutorialStep[] = [];
  private index = -1;
  private context: TutorialContext | null = null;

  get active(): boolean {
    return this.index >= 0;
  }

  get step(): TutorialStep | undefined {
    return this.steps[this.index];
  }

  start(context: TutorialContext): TutorialStep {
    this.context = context;
    this.steps = tutorialSteps(context);
    this.index = 0;
    return this.steps[0];
  }

  /** The answer to the question: the rest of the tour is for that. */
  answer(screenFree: boolean) {
    if (!this.context) return;
    this.context = { ...this.context, screenFree };
    const id = this.step?.id;
    this.steps = tutorialSteps(this.context);
    this.index = Math.max(0, this.steps.findIndex((s) => s.id === id));
  }

  /** The next step, or undefined at the end (the tutorial is then over). */
  advance(): TutorialStep | undefined {
    if (!this.active) return undefined;
    this.index++;
    if (this.index >= this.steps.length) this.end();
    return this.step;
  }

  end() {
    this.index = -1;
    this.steps = [];
  }

  view(): TutorialView | undefined {
    const step = this.step;
    if (!step) return undefined;
    return { step: this.index + 1, total: this.steps.length, title: step.title, text: step.say, question: !step.done };
  }
}
