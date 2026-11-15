import { createCn } from "cn/config";

/**
 * Class joining + Tailwind conflict resolution, taught the theme's own names (see index.css),
 * so `cn("text-xs", "text-2xs")` keeps the last size and `shadow-float` replaces `shadow-sm`.
 * Every component imports cn from here, never from "cn" directly.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs"] }],
      shadow: [{ shadow: ["float", "float-sm", "thumb"] }],
    },
  },
});
