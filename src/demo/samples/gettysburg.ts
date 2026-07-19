import type { SampleDefinition } from "./types";

/**
 * Coach Boone's Gettysburg speech — Remember the Titans.
 */
const SPEECH = `
Anybody know what this place is? This is Gettysburg.
This is where they fought the Battle of Gettysburg.
Fifty thousand men died right here on this field, fightin' the same fight that we're still fightin' amongst ourselves today.
This green field right here was painted red, bubblin' with the blood of young boys, smoke and hot lead pourin' right through their bodies. Listen to their souls, men:
'I killed my brother with malice in my heart. Hatred destroyed my family.'
You listen. And you take a lesson from the dead.
If we don't come together, right now, on this hallowed ground, we too will be destroyed -- just like they were.
I don't care if you like each other or not. But you will respect each other.
And maybe -- I don't know -- maybe we'll learn to play this game like men.
`.trim();

export const GETTYSBURG_SAMPLE: SampleDefinition = {
  id: "gettysburg",
  label: "Gettysburg",
  tooltip: "Denzel Washington — Remember the Titans",
  transcript: SPEECH.replace(/\n+/g, " ").replace(/\s+/g, " "),
  semanticGroups: [
    // Place / battle
    [
      "gettysburg",
      "battle",
      "field",
      "ground",
      "hallowed",
      "place",
      "where",
      "today",
    ],
    // Violence / death
    [
      "fight",
      "die",
      "dead",
      "blood",
      "body",
      "kill",
      "lead",
      "smoke",
      "hot",
      "pour",
      "destroy",
      "hatred",
      "malice",
    ],
    // Brotherhood / cost
    [
      "brother",
      "family",
      "boy",
      "young",
      "man",
      "soul",
      "heart",
      "thousand",
      "fifty",
    ],
    // Unity / respect / lesson
    [
      "together",
      "come",
      "listen",
      "lesson",
      "respect",
      "learn",
      "play",
      "game",
      "care",
      "know",
      "maybe",
    ],
  ],
};
