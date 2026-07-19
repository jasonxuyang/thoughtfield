import type { SampleDefinition } from "./types";

/**
 * "Golden" — KPop Demon Hunters (HUNTR/X).
 * Hangul lines stay as surface tokens; English uses the shared normalizer.
 */
const LYRICS = `
I was a ghost, I was alone
어두워진 앞길 속에 (ha-ah-ah)
Given the throne, I didn't know how to believe
I was the queen that I'm meant to be
I lived two lives, tried to play both sides
But I couldn't find my own place
Called a problem child 'cause I got too wild
But now that's how I'm getting paid 끝없이 on stage
I'm done hidin', now I'm shinin' like I'm born to be
We dreamin' hard, we came so far, now I believe
We're goin' up, up, up, it's our moment
You know together we're glowin'
Gonna be, gonna be golden
Oh-oh-oh, up, up, up with our voices
영원히 깨질 수 없는
Gonna be, gonna be golden
Oh-oh-oh, I'm done hidin', now I'm shinin' like I'm born to be
Oh, our time, no fears, no lies
That's who we're born to be
Waited so long to break these walls down
To wake up and feel like me
Put these patterns all in the past now
And finally live like the girl they all see
No more hiding, I'll be shinin' like I'm born to be
'Cause we are hunters, voices strong, and I know I believe
We're goin' up, up, up, it's our moment
You know together we're glowin'
Gonna be, gonna be golden
Oh-oh-oh, up, up, up with our voices
영원히 깨질 수 없는
Gonna be, gonna be golden
Oh-oh-oh, I'm done hidin', now I'm shinin' like I'm born to be
Oh, our time, no fears, no lies
That's who we're born to be
You know we're gonna be, gonna be golden
We're gonna be, gonna be
Born to be, born to be glowin'
밝게 빛나는 우린
You know that it's our time, no fears, no lies
That's who we're born to be
`.trim();

export const GOLDEN_SAMPLE: SampleDefinition = {
  id: "golden",
  label: "Golden",
  tooltip: "HUNTR/X — KPop Demon Hunters",
  transcript: LYRICS.replace(/\n+/g, " ").replace(/\s+/g, " "),
  semanticGroups: [
    // Identity / becoming
    [
      "ghost",
      "alone",
      "throne",
      "queen",
      "believe",
      "born",
      "mean",
      "girl",
      "place",
      "wake",
      "feel",
    ],
    // Hiding / duality / walls
    [
      "live",
      "life",
      "play",
      "side",
      "hide",
      "wall",
      "fear",
      "lie",
      "past",
      "pattern",
      "break",
      "wait",
    ],
    // Stage / hunters / voice
    [
      "stage",
      "pay",
      "problem",
      "child",
      "wild",
      "hunter",
      "voice",
      "strong",
      "끝없이",
    ],
    // Ascent / glow / golden
    [
      "go",
      "moment",
      "glow",
      "golden",
      "shine",
      "dream",
      "far",
      "time",
      "gonna",
      "together",
    ],
    // Hangul refrain / light
    [
      "어두워진",
      "앞길",
      "속에",
      "영원히",
      "깨질",
      "수",
      "없는",
      "밝게",
      "빛나는",
      "우린",
    ],
  ],
};
