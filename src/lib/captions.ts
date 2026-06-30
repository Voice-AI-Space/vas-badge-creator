// Ready-to-post social captions for the badge, tuned per platform AND per event
// type. Pure template logic, deterministic and offline. Voice is plain
// and human (no "thrilled to announce" filler), and there are no em dashes.

export type BadgeType = "I'm attending" | "I'm hosting" | "I'm speaking at" | "We're sponsoring";

export type PlatformId = "linkedin" | "x" | "instagram";

const HANDLE = "@voiceaispace";

// Preset event types for the dropdown.
export const EVENT_TYPES = ["Global Mixer", "Meetup", "Hackathon", "Workshop"] as const;

interface EventVoice {
  tag: string; // event-type hashtag
  hook: string; // short line that captures the vibe of this event type
  blurb: string; // longer line for the multi-paragraph posts
}

// Each event type gets its own voice so the captions actually read differently.
const EVENT_VOICE: Record<string, EventVoice> = {
  "Global Mixer": {
    tag: "#Mixer",
    hook: "Come for the room, stay for the people.",
    blurb: "Expect a full room and the kind of conversations you actually remember.",
  },
  Meetup: {
    tag: "#Meetup",
    hook: "Casual, in the best way.",
    blurb: "Low-key and high-signal, just good people talking shop.",
  },
  Hackathon: {
    tag: "#Hackathon",
    hook: "Build, break, ship.",
    blurb: "Two days, too much coffee, and something real shipped at the end.",
  },
  Workshop: {
    tag: "#Workshop",
    hook: "Bring a laptop, build something.",
    blurb:
      "Hands-on from the start. Bring a laptop and you'll leave having actually built something.",
  },
};

const eventVoice = (name: string): EventVoice =>
  EVENT_VOICE[name] ?? {
    tag: `#${name.replace(/[^a-zA-Z0-9]+/g, "")}`,
    hook: "Going to be a good one.",
    blurb: "Going to be a good one. Hope you can make it.",
  };

interface BadgeVoice {
  verb: string; // sentence-start phrase, always followed by the event, e.g. "Speaking at"
  iam: string; // first-person sentence opener, e.g. "I'm speaking at" / "I'll be at"
  ctas: [string, string, string, string]; // casual calls-to-action, one per variant
  blurb: string; // badge-flavored longer line
  emoji: string;
}

const BADGE_VOICE: Record<BadgeType, BadgeVoice> = {
  "I'm hosting": {
    verb: "Hosting",
    iam: "I'm hosting",
    ctas: ["Come hang out.", "Pull up.", "Would love to see you there.", "Bring a friend."],
    blurb:
      "If you're into voice AI and want a room full of people who actually build it, this is the one.",
    emoji: "🎤",
  },
  "I'm speaking at": {
    verb: "Speaking at",
    iam: "I'm speaking at",
    ctas: ["Come say hi.", "Catch my talk.", "Find me there.", "Let's talk shop."],
    blurb: "Come for the talk, stay for the hallway conversations. Usually the best part.",
    emoji: "🎙️",
  },
  "I'm attending": {
    verb: "Heading to",
    iam: "I'll be at",
    ctas: [
      "Who else is going?",
      "Say hi if you're around.",
      "Let's link up.",
      "DMs open if you'll be there.",
    ],
    blurb: "If you're building anything in voice AI, let's grab a few minutes between sessions.",
    emoji: "🎟️",
  },
  "We're sponsoring": {
    verb: "Sponsoring",
    iam: "We're sponsoring",
    ctas: [
      "Come find the team.",
      "Swing by and say hi.",
      "Pull up to our booth.",
      "Let's connect.",
    ],
    blurb: "Our team will be around all day. Come talk shop, no pitch required.",
    emoji: "🤝",
  },
};

export interface CaptionInput {
  badge: BadgeType;
  eventName: string;
  city: string;
  month: string;
  date: string;
}

export interface Caption {
  id: PlatformId;
  label: string;
  variants: string[];
}

/** Build several ready-to-post caption variants per platform, flavored by event type. */
export function buildCaptions(input: CaptionInput): Caption[] {
  const v = BADGE_VOICE[input.badge];
  const event = input.eventName.trim() || "Global Mixer";
  const ev = eventVoice(event);
  const city = input.city.trim();
  const eventLabel = `${event} "${city || "City"}"`;

  const month = input.month.trim();
  const date = input.date.trim();
  const dateLong = [month, date].filter(Boolean).join(" "); // "August 20"
  const dateShort = [month.slice(0, 3), date].filter(Boolean).join(" "); // "Aug 20"
  const citySlug = city.replace(/[^a-zA-Z0-9]+/g, "");
  const igTags = ["#VoiceAISpace", "#VoiceAI", ev.tag, citySlug && `#${citySlug}`, "#VoiceTech"]
    .filter(Boolean)
    .join(" ");

  // Date fragments that disappear cleanly when the date is blank (no em dashes).
  const onLong = dateLong ? ` on ${dateLong}` : "";
  const thisLong = dateLong ? ` this ${dateLong}` : "";
  const xDate = dateShort ? `, ${dateShort}` : "";

  const liTags = `${HANDLE} #VoiceAISpace #VoiceAI ${ev.tag}`;
  const linkedin = [
    `${v.iam} ${eventLabel}${onLong}. ${v.ctas[0]} ${liTags}`,
    `${v.verb} ${eventLabel}${onLong}. ${ev.hook} ${v.ctas[1]} ${liTags}`,
    `${v.iam} ${eventLabel}${onLong}.\n\n${ev.blurb} ${v.ctas[2]}\n\n${liTags}`,
    `${v.iam} ${eventLabel}${onLong}.\n\n${v.blurb} ${v.ctas[3]}\n\n${liTags}`,
  ];

  const x = [
    `${v.verb} ${eventLabel}${xDate} ${v.emoji} ${v.ctas[0]} ${HANDLE} #VoiceAISpace`,
    `${v.iam} ${eventLabel}${xDate}. ${ev.hook} ${v.ctas[1]} ${v.emoji} #VoiceAISpace ${ev.tag}`,
    `${v.verb} ${eventLabel}${xDate}. ${v.ctas[2]} ${HANDLE} #VoiceAISpace`,
    `${v.verb} ${eventLabel}${xDate} ${v.emoji} ${v.ctas[3]} ${HANDLE} ${ev.tag}`,
  ];

  const instagram = [
    `${v.verb} ${eventLabel}${thisLong} ${v.emoji}\n.\n${HANDLE} ${igTags}`,
    `${v.iam} ${eventLabel}${onLong} ${v.emoji}\n${ev.hook}\n${v.ctas[1]}\n.\n${HANDLE} ${igTags}`,
    `${v.verb} ${eventLabel}${thisLong} ${v.emoji}\n${v.ctas[2]}\n.\n${HANDLE} ${igTags}`,
    `${v.verb} ${eventLabel}${thisLong} ${v.emoji}\n${ev.blurb} ${v.ctas[3]}\n.\n${HANDLE} ${igTags}`,
  ];

  return [
    { id: "linkedin", label: "LinkedIn", variants: linkedin },
    { id: "x", label: "X / Twitter", variants: x },
    { id: "instagram", label: "Instagram", variants: instagram },
  ];
}
